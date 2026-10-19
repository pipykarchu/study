import { randomUUID } from 'node:crypto';
import { setGlobalProxyFromEnv } from 'node:http';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient, StudyError, learningScope, learningTools, childEnvironment } from './codex-client.mjs';

const MAX_BYTES = 512 * 1024;

export async function configureBridgeProxy({ resolveEnvironment = childEnvironment, applyProxy = setGlobalProxyFromEnv } = {}) {
  const environment = await resolveEnvironment();
  const proxyEnv = {};
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
    if (typeof environment[key] === 'string') proxyEnv[key] = environment[key];
  }
  const allProxy = environment.all_proxy || environment.ALL_PROXY;
  if (allProxy) {
    if (!proxyEnv.http_proxy && !proxyEnv.HTTP_PROXY) proxyEnv.HTTP_PROXY = allProxy;
    if (!proxyEnv.https_proxy && !proxyEnv.HTTPS_PROXY) proxyEnv.HTTPS_PROXY = allProxy;
  }
  // This affects only this Node process. Explicit proxy environment variables
  // already take precedence over the current user's enabled Windows proxy.
  return applyProxy(proxyEnv);
}
const wait = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const end = () => { clearTimeout(timer); signal?.removeEventListener('abort', end); resolve(); };
  const timer = setTimeout(end, ms);
  signal?.addEventListener('abort', end, { once: true });
});

export function bridgeConfig(raw, { allowLocalOrigin = false } = {}) {
  let url;
  try { url = new URL(raw?.siteUrl); } catch { throw new Error('云端连接配置无效。'); }
  const local = allowLocalOrigin && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:';
  if (raw?.version !== 1 || (!local && (url.protocol !== 'https:' || !url.hostname.endsWith('.chatgpt.site') || url.port))
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || typeof raw.siteBearerToken !== 'string' || !/^[A-Za-z0-9._~+/-]{32,8192}={0,2}$/.test(raw.siteBearerToken)
    || typeof raw.bridgeKey !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(raw.bridgeKey)
    || Object.keys(raw).some((key) => !['version', 'siteUrl', 'siteBearerToken', 'bridgeKey'].includes(key))) throw new Error('云端连接配置无效。');
  return Object.freeze({ ...raw, siteUrl: url.origin });
}

function boundedId(value, limit = 256) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u0020]/.test(value); }
function safeError(error) { return error instanceof StudyError ? error.message.slice(0, 500) : '会员连接暂时中断，请稍后重试；这次问题不会自动重发。'; }

export function validateJob(job) {
  if (!job || !boundedId(job.id, 100) || !boundedId(job.leaseToken) || typeof job.message !== 'string' || !job.message.trim()
    || job.message.length > 16000 || typeof job.context !== 'string' || job.context.length > 48000
    || (job.conversationId !== undefined && job.conversationId !== null && !boundedId(job.conversationId, 200))) throw new StudyError('云端学习任务无效。', 400, 'bridge_job');
  learningScope(job);
  return { ...job, toolDefinitions: learningTools(job.toolDefinitions || []) };
}

export class CloudBridge {
  constructor({ config, client, fetchImpl = fetch, heartbeatMs = 8000, idleMs = 1500, controlMs = 750, toolTimeoutMs = 60000, allowLocalOrigin = false } = {}) {
    this.config = bridgeConfig(config, { allowLocalOrigin });
    this.client = client || new CodexClient({ cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
    this.fetchImpl = fetchImpl;
    this.heartbeatMs = heartbeatMs;
    this.idleMs = idleMs;
    this.controlMs = controlMs;
    this.toolTimeoutMs = toolTimeoutMs;
    this.stopController = new AbortController();
    this.seenJobs = new Set();
    this.active = null;
    this.heartbeatPending = null;
  }

  async post(endpoint, data, signal) {
    if (!['heartbeat', 'claim', 'events', 'control'].includes(endpoint)) throw new Error('连接路径无效。');
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('连接内容过长。');
    let response;
    try {
      response = await this.fetchImpl(`${this.config.siteUrl}/api/bridge/${endpoint}`, {
        method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': `Bearer ${this.config.siteBearerToken}`, 'X-Study-Bridge-Key': this.config.bridgeKey },
        body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Cloud unavailable.');
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_BYTES) throw new Error('Response too large.');
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.length;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Response too large.'); }
        chunks.push(Buffer.from(next.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new StudyError('会员连接暂时中断，请稍后重试；这次问题不会自动重发。', 503, 'bridge_offline'); }
  }

  heartbeat() {
    if (this.heartbeatPending) return this.heartbeatPending;
    this.heartbeatPending = (async () => {
      const status = await this.client.status();
      return this.post('heartbeat', {
        available: Boolean(status.available), authenticated: Boolean(status.authenticated && status.ownerVerified),
        model: typeof status.model === 'string' ? status.model.slice(0, 120) : '',
        modelNotice: typeof status.modelNotice === 'string' ? status.modelNotice.slice(0, 500) : '',
        busy: Boolean(this.active || status.busy),
      }, this.stopController.signal);
    })().finally(() => { this.heartbeatPending = null; });
    return this.heartbeatPending;
  }

  async start() {
    const interval = setInterval(() => { this.heartbeat().catch(() => {}); }, this.heartbeatMs);
    try {
      await this.heartbeat().catch(() => {});
      while (!this.stopController.signal.aborted) {
        try {
          const claim = await this.post('claim', {}, this.stopController.signal);
          if (claim.job) await this.runJob(claim.job);
        } catch { /* A disconnected job never repeats its inference request. Idle polling may reconnect. */ }
        await wait(this.idleMs, this.stopController.signal);
      }
    } finally { clearInterval(interval); this.client.close(); }
  }

  async runJob(raw) {
    const job = validateJob(raw);
    if (this.active) throw new StudyError('连接器正在回答另一个问题。', 409, 'busy');
    if (this.seenJobs.has(job.id)) return; // Lease replay must never submit a second model turn.
    this.seenJobs.add(job.id);
    if (this.seenJobs.size > 500) this.seenJobs.delete(this.seenJobs.values().next().value);
    const state = { job, conversationId: null, nextSeq: 0, queue: [], bytes: 0, pendingTools: new Map(), ended: false, delivery: Promise.resolve(), transportError: null, controller: new AbortController() };
    this.active = state;
    const cancel = () => {
      state.controller.abort();
      if (state.conversationId) this.client.cancel(state.conversationId, job);
      for (const pending of state.pendingTools.values()) pending.reject(new StudyError('已停止这次学习操作。', 409, 'cancelled'));
      state.pendingTools.clear();
    };
    const push = (event) => {
      const record = { seq: ++state.nextSeq, ...event };
      const serialized = JSON.stringify(record);
      const size = Buffer.byteLength(serialized);
      if (size > 200000 || serialized.length > 65000 || state.bytes + size > 1024 * 1024) throw new StudyError('回答内容过长，已停止，请把问题拆小。', 413, 'bridge_limit');
      state.bytes += size;
      state.queue.push({ record, size, chars: serialized.length });
    };
    const flush = () => {
      const next = state.delivery.then(async () => {
        while (state.queue.length) {
          const batch = [];
          let bytes = 512;
          let chars = 512;
          for (const item of state.queue) {
            if (bytes + item.size >= 400000 || chars + item.chars >= 120000 || batch.length >= 50) break;
            batch.push(item); bytes += item.size; chars += item.chars;
          }
          const data = { jobId: job.id, leaseToken: job.leaseToken, events: batch.map((item) => item.record) };
          try { await this.post('events', data, this.stopController.signal); }
          catch { await this.post('events', data, this.stopController.signal); } // Same seq: transport retry only, never model retry.
          state.queue.splice(0, batch.length);
          for (const item of batch) state.bytes -= item.size;
        }
      });
      state.delivery = next;
      next.catch((error) => { if (!state.transportError) { state.transportError = error; cancel(); } });
      return next;
    };
    const eventTimer = setInterval(() => { if (state.queue.length) flush().catch(() => {}); }, 100);
    const control = (async () => {
      while (!state.ended && !this.stopController.signal.aborted && !state.controller.signal.aborted) {
        try {
          const result = await this.post('control', { jobId: job.id, leaseToken: job.leaseToken, callIds: [...state.pendingTools.keys()] }, state.controller.signal);
          if (result.cancelled) { cancel(); return; }
          if (!Array.isArray(result.results) || result.results.length > 30) throw new Error('Invalid control.');
          for (const item of result.results) {
            const pending = state.pendingTools.get(item?.callId);
            if (!pending || item.nonce !== pending.nonce) continue;
            state.pendingTools.delete(item.callId);
            pending.resolve(item.result);
          }
        } catch (error) {
          if (!state.ended && !state.controller.signal.aborted) { state.transportError = error; cancel(); }
          return;
        }
        await wait(this.controlMs, state.controller.signal);
      }
    })();
    const toolHandler = async (call) => {
      if (state.ended || state.controller.signal.aborted || call.signal.aborted || call.roleId !== job.roleId || call.profileId !== job.profileId
        || call.conversationId !== state.conversationId || state.pendingTools.has(call.callId)) throw new Error('Stale learning scope.');
      const nonce = randomUUID();
      let timer;
      let onAbort;
      const answer = new Promise((resolve, reject) => {
        timer = setTimeout(() => { state.pendingTools.delete(call.callId); reject(new StudyError('网页没有及时回应，请保持当前学习页打开后重试。', 504, 'tool_timeout')); }, this.toolTimeoutMs);
        onAbort = () => { state.pendingTools.delete(call.callId); reject(new StudyError('学习操作已停止。', 409, 'cancelled')); };
        call.signal.addEventListener('abort', onAbort, { once: true });
        state.pendingTools.set(call.callId, { nonce, resolve, reject });
      });
      answer.catch(() => {});
      try {
        push({ type: 'tool_call', callId: call.callId, nonce, name: call.name, arguments: call.arguments, roleId: job.roleId, profileId: job.profileId, conversationId: call.conversationId });
        await flush();
        return await answer;
      } finally { clearTimeout(timer); call.signal.removeEventListener('abort', onAbort); state.pendingTools.delete(call.callId); }
    };
    try {
      await this.client.chat({ ...job, tools: job.toolDefinitions, toolHandler }, (event) => {
        if (event.type === 'conversation') state.conversationId = event.conversationId;
        if (!state.controller.signal.aborted) {
          if (event.type === 'delta' && typeof event.text === 'string') {
            for (let offset = 0; offset < event.text.length; offset += 10000) push({ ...event, text: event.text.slice(offset, offset + 10000) });
          } else push(event);
        }
      });
    } catch (error) {
      if (!state.transportError) {
        push({ type: 'error', message: safeError(error) });
        push({ type: 'done' });
      }
    } finally {
      state.ended = true;
      clearInterval(eventTimer);
      cancel();
      await control.catch(() => {});
      await flush().catch(() => {});
      if (this.active === state) this.active = null;
      await this.heartbeat().catch(() => {});
    }
  }

  stop() {
    this.stopController.abort();
    if (this.active) {
      this.active.controller.abort();
      if (this.active.conversationId) this.client.cancel(this.active.conversationId, this.active.job);
    }
    this.client.close();
  }
}

export async function acquireBridgeLock(root) {
  const directory = path.join(root, '.local-runtime');
  const lockFile = path.join(directory, 'cloud-bridge.lock');
  await mkdir(directory, { recursive: true });
  const marker = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, marker }));
      await handle.close();
      return async () => { try { if (JSON.parse(await readFile(lockFile, 'utf8')).marker === marker) await unlink(lockFile); } catch { /* Only remove our own lock. */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { const text = await readFile(lockFile, 'utf8'); if (text.length > 1024) throw new Error(); existing = JSON.parse(text); } catch { throw new Error('连接器锁文件无效，请回到 Codex 检查。'); }
      if (!Number.isSafeInteger(existing.pid) || existing.pid < 1) throw new Error('连接器锁文件无效，请回到 Codex 检查。');
      let alive = true;
      try { process.kill(existing.pid, 0); } catch (check) { alive = check.code !== 'ESRCH'; }
      if (alive) return null;
      await unlink(lockFile);
    }
  }
  throw new Error('连接器暂时无法启动。');
}

async function stdinConfig() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 16000) throw new Error('配置过长。'); chunks.push(chunk); }
  return bridgeConfig(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim()));
}

async function main() {
  const config = await stdinConfig();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const release = await acquireBridgeLock(root);
  if (!release) { process.stdout.write('{"alreadyRunning":true}\n'); return; }
  const restoreProxy = await configureBridgeProxy();
  const bridge = new CloudBridge({ config, client: new CodexClient({ cwd: root }) });
  const stop = () => bridge.stop();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdout.write('{"started":true}\n');
  try { await bridge.start(); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); restoreProxy(); await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  main().catch(() => { process.stderr.write('会员连接器启动失败，请回到 Codex 检查连接配置。\n'); process.exitCode = 1; });
}
