import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DISABLED_FEATURES = [
  'apps', 'plugins', 'remote_plugin', 'shell_tool', 'shell_snapshot',
  'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'in_app_browser', 'computer_use', 'image_generation', 'multi_agent',
  'multi_agent_v2', 'code_mode', 'code_mode_host', 'code_mode_only',
  'workspace_dependencies', 'skill_search', 'skill_mcp_dependency_install',
  'skill_env_var_dependency_prompt', 'memories', 'hooks', 'tool_suggest',
];
const TEACHER_INSTRUCTIONS = [
  '你是知芽私人学习网站的学习教练。用中文、大白话，直接帮助用户理解知识。',
  '先回答当前问题；需要时说明知识框架、必学/选学/暂不学边界、一个小练习和验收标准。',
  '这是纯文字教学会话。只根据用户提供的学习背景和你的知识回答，不执行命令，不读写文件，',
  '不调用浏览器、联网搜索、应用、连接器、MCP、技能、子代理或任何其他工具。',
  '不声称执行了没有执行的操作。不知道或需要最新资料时明确说明。',
].join('');

export class StudyError extends Error {
  constructor(message, status = 503, code = 'codex_unavailable') {
    super(message);
    this.name = 'StudyError';
    this.status = status;
    this.code = code;
  }
}

export function learningScope({ roleId, profileId } = {}) {
  if (!['apple', 'sheep'].includes(roleId) || !['product', 'coding', 'custom', 'fde'].includes(profileId)) {
    throw new StudyError('学习角色或方向已变化，请刷新后重新提问。', 400, 'learning_scope');
  }
  return `${roleId}:${profileId}`;
}

function turnFailure(error) {
  if (error?.codexErrorInfo === 'serverOverloaded' || (typeof error?.message === 'string' && /Selected model is at capacity/i.test(error.message))) {
    return new StudyError('当前 Codex 模型繁忙，请稍后重试。', 503, 'codex_busy');
  }
  return new StudyError('Codex 回答失败，请稍后重试。', 503, 'codex_failed');
}

function defaultCommand() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/@openai/codex/bin/codex.js'),
    path.join(homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js'),
  ].filter(Boolean);
  const entry = candidates.find((candidate) => existsSync(candidate));
  return entry ? { command: process.execPath, args: [entry] } : { command: 'codex', args: [] };
}

// Read only section names to turn existing MCP servers off; credentials are never copied or logged.
function disabledMcpOverrides(cwd) {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  const files = [path.join(codexHome, 'config.toml'), path.join(cwd, '.codex/config.toml')];
  const names = new Set();
  for (const file of files) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*\[\s*mcp_servers\.(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\.|\s*\])/);
      if (!match) continue;
      try { names.add(match[1] ? JSON.parse(`"${match[1]}"`) : match[2] || match[3]); } catch { /* Ignore invalid TOML. */ }
    }
  }
  // CLI dotted overrides split on dots; quoted segments are not TOML-parsed.
  // Other server names are disabled by the thread-level resolved config instead.
  return [...names].filter((name) => /^[A-Za-z0-9_-]+$/.test(name)).map((name) => `mcp_servers.${name}.enabled=false`);
}

export function buildCodexArgs(cwd, prefix = []) {
  const args = [...prefix, 'app-server', '--listen', 'stdio://'];
  for (const feature of DISABLED_FEATURES) args.push('--disable', feature);
  for (const override of [
    'approval_policy="never"', 'sandbox_mode="read-only"', 'web_search="disabled"',
    'tools.view_image=false', 'mcp_servers={}', ...disabledMcpOverrides(cwd),
  ]) args.push('-c', override);
  return args;
}

export function parseWindowsProxy(enabledOutput, serverOutput) {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabledOutput)) return null;
  const raw = serverOutput.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
  if (!raw) return null;
  const protocolEntries = raw.split(';').map((entry) => entry.trim()).filter(Boolean);
  const entries = Object.fromEntries(protocolEntries.filter((entry) => entry.includes('=')).map((entry) => {
    const index = entry.indexOf('=');
    return [entry.slice(0, index).toLowerCase(), entry.slice(index + 1)];
  }));
  const fallback = protocolEntries.find((entry) => !entry.includes('='));
  const normalize = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value.includes('://') ? value : `http://${value}`);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const https = normalize(entries.https || entries.http || fallback);
  const http = normalize(entries.http || fallback || entries.https);
  return https || http ? { https, http } : null;
}

async function childEnvironment() {
  const env = { ...process.env };
  // Explicit process proxy settings take precedence. Never change Windows or global Codex settings.
  if (process.platform !== 'win32' || Object.entries(env).some(([key, value]) => /^(?:https?|all)_proxy$/i.test(key) && value)) return env;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const options = { windowsHide: true, timeout: 2000, maxBuffer: 16384 };
    const [enabled, server] = await Promise.all([
      execFileAsync('reg.exe', ['query', key, '/v', 'ProxyEnable'], options),
      execFileAsync('reg.exe', ['query', key, '/v', 'ProxyServer'], options),
    ]);
    const proxy = parseWindowsProxy(enabled.stdout, server.stdout);
    if (proxy?.https) env.HTTPS_PROXY = proxy.https;
    if (proxy?.http) env.HTTP_PROXY = proxy.http;
    if (proxy) env.NO_PROXY = [env.NO_PROXY || env.no_proxy, '127.0.0.1', 'localhost', '[::1]'].filter(Boolean).join(',');
  } catch { /* A missing/unsupported Windows proxy leaves explicit process settings untouched. */ }
  return env;
}

export class CodexClient {
  constructor({ cwd, commandSpec, spawnProcess = spawn, rpcTimeoutMs = 30000, turnTimeoutMs = 300000, ownerFile, credentialFile } = {}) {
    this.cwd = path.resolve(cwd || process.cwd());
    this.ownerFile = ownerFile || path.join(this.cwd, '.local-runtime', 'owner.json');
    this.credentialFile = credentialFile || path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'auth.json');
    this.credentialRevision = this.readCredentialRevision();
    this.identityEpoch = 0;
    this.ownerVerified = false;
    this.authError = null;
    this.credentialWatcher = null;
    this.commandSpec = commandSpec || defaultCommand();
    this.spawnProcess = spawnProcess;
    this.rpcTimeoutMs = rpcTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.process = null;
    this.ready = false;
    this.starting = null;
    this.pending = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.authenticated = false;
    this.authType = null;
    this.model = null;
    this.modelNotice = null;
    this.disabledMcpServers = {};
    this.conversations = new Map();
    this.active = null;
    this.closed = false;
    try {
      // Watch only metadata changes. Login passwords and tokens are never read by this service.
      this.credentialWatcher = watch(path.dirname(this.credentialFile), { persistent: false }, (_event, filename) => {
        if (!filename || String(filename).toLowerCase() === path.basename(this.credentialFile).toLowerCase()) this.checkCredentialRevision();
      });
      this.credentialWatcher.on('error', () => { /* Per-request metadata checks remain active. */ });
    } catch { /* A missing credential directory is checked again before every request. */ }
  }

  get busy() { return Boolean(this.active); }

  async status() {
    try { await this.authorize(); } catch { /* The public status contains no raw diagnostic output. */ }
    return {
      available: this.ready,
      authenticated: this.ready && this.authenticated,
      ownerOnly: true,
      ownerVerified: this.ready && this.ownerVerified,
      authType: this.ready ? this.authType : null,
      model: this.model,
      busy: this.busy,
      ...(this.authError ? { authError: this.authError } : {}),
      ...(this.modelNotice ? { modelNotice: this.modelNotice } : {}),
    };
  }

  readCredentialRevision() {
    try {
      const info = statSync(this.credentialFile, { bigint: true });
      return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    } catch { return 'missing'; }
  }

  checkCredentialRevision() {
    const revision = this.readCredentialRevision();
    if (revision === this.credentialRevision) return;
    this.credentialRevision = revision;
    this.invalidateIdentity();
  }

  invalidateIdentity() {
    this.identityEpoch += 1;
    this.authenticated = false;
    this.ownerVerified = false;
    this.authType = null;
    this.authError = 'account_changed';
    this.conversations.clear();
    if (this.ready || this.process) {
      this.active?.finish(new StudyError('Codex 登录状态已变化，请确认仍是你的账号，然后新建对话。', 403, 'account_changed'));
      this.stopProcess();
    }
  }

  async verifyOwnerAccount() {
    let owner;
    try {
      const info = statSync(this.ownerFile);
      if (!info.isFile() || info.size > 1024) throw new Error('Invalid owner file.');
      owner = JSON.parse(readFileSync(this.ownerFile, 'utf8'));
      if (owner?.version !== 1 || !/^[a-f0-9]{64}$/.test(owner.emailSha256)) throw new Error('Invalid owner binding.');
    } catch {
      this.authError = 'owner_not_configured';
      this.authenticated = this.ownerVerified = false;
      this.conversations.clear();
      throw new StudyError('尚未绑定站点主人，学习助手已暂停。请回到 Codex 完成本人账号校验。', 403, 'owner_not_configured');
    }
    this.checkCredentialRevision();
    if (!this.process) throw new StudyError('Codex 登录状态已变化，请新建对话。', 403, 'account_changed');
    const epoch = this.identityEpoch;
    const result = await this.rpc('account/read', { refreshToken: false });
    this.checkCredentialRevision();
    if (epoch !== this.identityEpoch) throw new StudyError('Codex 登录状态已变化，请新建对话。', 403, 'account_changed');
    const account = result?.account;
    const email = account?.type === 'chatgpt' && typeof account.email === 'string' ? account.email.trim().toLowerCase() : '';
    const actual = createHash('sha256').update(email).digest();
    const expected = Buffer.from(owner.emailSha256, 'hex');
    if (!email || !timingSafeEqual(actual, expected)) {
      this.conversations.clear();
      this.authenticated = this.ownerVerified = false;
      this.authType = null;
      this.authError = account ? 'owner_mismatch' : 'codex_login_required';
      throw new StudyError(account ? '当前 Codex 账号不是站点主人，已拒绝使用。请切回你自己的账号。' : '请先在本机 Codex 登录你的本人账号，再回来重试。', account ? 403 : 401, this.authError);
    }
    this.authType = 'chatgpt';
    this.authenticated = this.ownerVerified = true;
    this.authError = null;
  }

  async authorize() {
    await this.ensureReady();
    try { await this.verifyOwnerAccount(); }
    catch (error) {
      this.active?.finish(error);
      this.stopProcess();
      throw error;
    }
  }

  async ensureReady() {
    if (this.closed) throw new StudyError('本机学习助手已关闭，请重新启动知芽。');
    this.checkCredentialRevision();
    if (this.ready && this.process) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // Retry only process initialization. A submitted model turn is never automatically repeated.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.startProcess();
          await this.rpc('initialize', { clientInfo: { name: 'study_bloom_local', title: '知芽私人学习教练', version: '1.0.0' } });
          this.notify('initialized', {});
          await this.verifyOwnerAccount();
          // config/read is local and does not send an inference request. Keep only the model label.
          try {
            const config = await this.rpc('config/read', { includeLayers: false });
            if (typeof config?.config?.model === 'string') this.model = config.config.model;
            this.modelNotice = null;
            this.disabledMcpServers = Object.fromEntries(Object.keys(config?.config?.mcp_servers || {}).map((name) => [name, { enabled: false }]));
          } catch { /* Model is also returned when a teaching thread starts. */ }
          try {
            const models = [];
            let cursor;
            let complete = false;
            for (let page = 0; page < 10; page += 1) {
              const result = await this.rpc('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
              if (!Array.isArray(result?.data)) break;
              models.push(...result.data);
              if (!result.nextCursor) { complete = true; break; }
              cursor = result.nextCursor;
            }
            const visible = new Set(models.flatMap((entry) => [entry.model, entry.id].filter((value) => typeof value === 'string')));
            const defaultEntry = models.find((entry) => entry.isDefault);
            const defaultModel = defaultEntry?.model || defaultEntry?.id;
            if (complete && this.model && !visible.has(this.model) && typeof defaultModel === 'string') {
              this.model = defaultModel;
              this.modelNotice = '已使用当前账号可用的默认模型，未修改 Codex 全局设置。';
            }
          } catch { /* A failed/incomplete model catalog must not silently change the configured model. */ }
          if (!this.process || !this.ownerVerified) throw new StudyError('Codex 登录状态已变化，请新建对话。', 403, 'account_changed');
          this.ready = true;
          return;
        } catch (error) {
          this.stopProcess();
          if (['owner_not_configured', 'owner_mismatch', 'codex_login_required', 'account_changed'].includes(error?.code)) throw error;
          if (this.closed || this.active?.cancelled) throw new StudyError('已停止这次回答。', 503, 'cancelled');
          if (attempt === 1) throw new StudyError('本机 Codex 暂时无法启动，请确认 Codex 已安装并登录后重试。');
        }
      }
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  async startProcess() {
    this.ready = false;
    const env = await childEnvironment();
    if (this.closed || this.active?.cancelled) throw new StudyError('已停止这次回答。', 503, 'cancelled');
    const generation = ++this.generation;
    let child;
    try {
      child = this.spawnProcess(this.commandSpec.command, buildCodexArgs(this.cwd, this.commandSpec.args), {
        cwd: this.cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return Promise.reject(new StudyError('本机 Codex 无法启动，请检查安装。'));
    }
    this.process = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (generation !== this.generation) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > 8 * 1024 * 1024) {
        this.processFailure(generation);
        return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { this.onMessage(JSON.parse(line)); } catch { this.processFailure(generation); return; }
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => { if (generation === this.generation) this.processFailure(generation); });
    child.on('exit', () => this.processFailure(generation));
    child.on('error', () => this.processFailure(generation));
    return new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new StudyError('本机 Codex 无法启动，请检查安装。')));
    });
  }

  processFailure(generation) {
    if (generation !== this.generation) return;
    const initializing = Boolean(this.starting);
    this.stopProcess();
    if (!initializing) this.active?.finish(new StudyError('Codex 连接已中断，请重新发送问题。'));
  }

  stopProcess() {
    this.ready = false;
    this.authenticated = false;
    this.ownerVerified = false;
    this.authType = null;
    this.generation += 1;
    const child = this.process;
    this.process = null;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new StudyError('Codex 连接已中断，请重新发送问题。'));
    }
    this.pending.clear();
    if (child) {
      child.stdin.destroy();
      try { child.kill(); } catch { /* Already exited. */ }
    }
  }

  write(message) {
    if (!this.process || this.process.stdin.destroyed) throw new StudyError('Codex 连接已中断，请重新发送问题。');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) { this.write({ method, params }); }

  rpc(method, params, timeoutMs = this.rpcTimeoutMs) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new StudyError('Codex 响应超时，请稍后重试。', 504, 'codex_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  onMessage(message) {
    this.checkCredentialRevision();
    if (!this.process) return;
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new StudyError('Codex 暂时无法完成请求，请稍后重试。'));
      else pending.resolve(message.result);
      return;
    }
    const { method, params = {} } = message;
    if (message.id !== undefined) {
      // A text-only coach never grants a request to use local tools or credentials.
      this.write({ id: message.id, error: { code: -32601, message: 'Tools and approvals are unavailable in this text-only client.' } });
      return;
    }
    // A notification carries no verified identity. Never treat an auth mode as proof of ownership.
    if (method === 'account/updated') {
      if (this.ready || this.authenticated) this.invalidateIdentity();
      else this.conversations.clear(); // Initial notifications still require account/read verification.
      return;
    }
    const active = this.active;
    if (!active || active.finished || params.threadId !== active.threadId) return;
    if (method === 'turn/started') {
      active.turnId = params.turn?.id || active.turnId;
      if (active.cancelled) this.interrupt(active);
    }
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      if (params.turnId && active.turnId && params.turnId !== active.turnId) return;
      active.itemText.set(params.itemId, (active.itemText.get(params.itemId) || '') + params.delta);
      active.emit({ type: 'delta', text: params.delta });
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') {
      const streamed = active.itemText.get(params.item.id) || '';
      if (!streamed) active.emit({ type: 'delta', text: params.item.text });
      else if (params.item.text.startsWith(streamed) && params.item.text.length > streamed.length) {
        active.emit({ type: 'delta', text: params.item.text.slice(streamed.length) });
      }
      active.itemText.set(params.item.id, params.item.text);
    }
    if (method === 'error' && !params.willRetry) active.finish(turnFailure(params.error));
    if (method === 'turn/completed') {
      if (active.turnId && params.turn?.id && params.turn.id !== active.turnId) return;
      const status = params.turn?.status;
      if (status === 'completed' && !active.cancelled) active.finish();
      else active.finish(active.cancelled || status === 'interrupted'
        ? new StudyError('已停止这次回答。', 503, 'cancelled')
        : turnFailure(params.turn?.error));
    }
  }

  async chat({ message, context = '', conversationId, roleId, profileId }, emit) {
    const scope = learningScope({ roleId, profileId });
    if (this.busy) throw new StudyError('学习教练正在回答，请等回答结束后再发。', 409, 'busy');
    if (conversationId && !this.conversations.has(conversationId)) throw new StudyError('这段对话已失效，请点新对话重新开始。', 404, 'conversation_expired');
    if (conversationId && this.conversations.get(conversationId).scope !== scope) throw new StudyError('这段对话属于另一角色或学习方向，请新建对话。', 409, 'conversation_scope');
    const publicId = conversationId || randomUUID();
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    // Attach a rejection handler immediately, including failures while initialization is pending.
    completion.catch(() => {});
    const active = {
      publicId, scope, threadId: this.conversations.get(publicId)?.threadId || null, turnId: null,
      cancelled: false, finished: false, emit, itemText: new Map(), timer: null,
      finish: (error) => {
        if (active.finished) return;
        active.finished = true;
        clearTimeout(active.timer);
        if (error) rejectCompletion(error); else resolveCompletion();
      },
    };
    this.active = active;
    active.timer = setTimeout(() => {
      active.cancelled = true;
      this.interrupt(active);
      active.finish(new StudyError('这次回答时间较长，已停止。请把问题拆小后重试。', 504, 'codex_timeout'));
      this.stopProcess();
    }, this.turnTimeoutMs);
    emit({ type: 'conversation', conversationId: publicId });
    try {
      await this.authorize();
      if (active.finished || active.cancelled) throw new StudyError('已停止这次回答。', 503, 'cancelled');
      if (conversationId && !this.conversations.has(conversationId)) throw new StudyError('登录状态已变化，请新建对话。', 403, 'account_changed');
      const options = {
        cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only',
        developerInstructions: TEACHER_INSTRUCTIONS,
        config: { web_search: 'disabled', tools: { view_image: false }, mcp_servers: this.disabledMcpServers },
        ...(this.model ? { model: this.model } : {}),
      };
      const thread = active.threadId
        ? await this.rpc('thread/resume', { ...options, threadId: active.threadId })
        : await this.rpc('thread/start', { ...options, serviceName: 'study_bloom_local' });
      if (typeof thread?.model === 'string') this.model = thread.model;
      active.threadId = thread?.thread?.id;
      if (!active.threadId) throw new StudyError('Codex 没有建立对话，请重试。');
      this.conversations.set(publicId, { threadId:active.threadId, scope });
      if (this.conversations.size > 100) this.conversations.delete(this.conversations.keys().next().value);
      if (active.finished || active.cancelled) throw new StudyError('已停止这次回答。', 503, 'cancelled');
      await this.verifyOwnerAccount();
      if (active.finished || active.cancelled) throw new StudyError('已停止这次回答。', 503, 'cancelled');
      const text = `${context ? `以下是当前学习背景，请仅作为背景理解：\n<学习背景>\n${context}\n</学习背景>\n\n` : ''}我的问题：\n${message}`;
      const turn = await this.rpc('turn/start', {
        threadId: active.threadId,
        input: [{ type: 'text', text }],
        approvalPolicy: 'never',
        // Current runtimes reject the retired readOnly.access field even though it
        // still appears in some generated schemas. Keep the supported read-only policy.
        sandboxPolicy: { type: 'readOnly' },
      });
      active.turnId = turn?.turn?.id || active.turnId;
      if (active.cancelled && !active.finished) this.interrupt(active);
      await completion;
      emit({ type: 'done' });
    } catch (error) {
      active.finish(error);
      this.stopProcess();
      throw error instanceof StudyError ? error : new StudyError('Codex 暂时无法回答，请稍后重试。');
    } finally {
      clearTimeout(active.timer);
      if (this.active === active) this.active = null;
    }
  }

  interrupt(active) {
    if (!active.threadId || !active.turnId || !this.process || active.interrupting) return;
    active.interrupting = true;
    this.rpc('turn/interrupt', { threadId: active.threadId, turnId: active.turnId }, 5000).catch(() => {
      if (this.active === active) {
        active.finish(new StudyError('已停止这次回答。', 503, 'cancelled'));
        this.stopProcess();
      }
    });
  }

  cancel(conversationId, target) {
    const active = this.active;
    if (!active || active.publicId !== conversationId || active.scope !== learningScope(target)) return false;
    active.cancelled = true;
    if (!active.turnId) {
      active.finish(new StudyError('已停止这次回答。', 503, 'cancelled'));
      this.stopProcess();
    } else {
      this.interrupt(active);
      const stopTimer = setTimeout(() => {
        if (this.active === active) {
          active.finish(new StudyError('已停止这次回答。', 503, 'cancelled'));
          this.stopProcess();
        }
      }, 6000);
      completionCleanup(active, stopTimer);
    }
    return true;
  }

  close() {
    this.closed = true;
    this.credentialWatcher?.close();
    this.active?.finish(new StudyError('学习助手已关闭。', 503, 'closed'));
    this.stopProcess();
  }
}

function completionCleanup(active, timer) {
  const finish = active.finish;
  active.finish = (error) => { clearTimeout(timer); finish(error); };
}
