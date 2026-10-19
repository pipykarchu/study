import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient, StudyError } from './codex-client.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 64 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function replyJson(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function secretEquals(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new StudyError('请使用 JSON 格式发送请求。', 415, 'content_type');
  const contentLength = req.headers['content-length'];
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY)) throw new StudyError('发送的内容太长，请缩短后再试。', 413, 'body_too_large');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new StudyError('发送的内容太长，请缩短后再试。', 413, 'body_too_large');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StudyError('请求内容格式有误，请刷新后重试。', 400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudyError('请求内容格式有误。', 400, 'invalid_json');
  return body;
}

export function createStudyServer({ port = 4175, client, distRoot = path.join(PROJECT_ROOT, 'dist'), rateLimits = {} } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local server port.');
  const codex = client || new CodexClient({ cwd: PROJECT_ROOT });
  const token = randomBytes(32).toString('base64url');
  const root = path.resolve(distRoot);
  let origin;
  let canonicalHost;
  const sockets = new Set();
  const limits = { windowMs: 60000, api: 120, chat: 12, ...rateLimits };
  if (!Object.values(limits).every((value) => Number.isInteger(value) && value > 0)) throw new Error('Invalid local request limits.');
  const windows = new Map();
  const allowRequest = (name) => {
    const now = Date.now();
    let window = windows.get(name);
    if (!window || now >= window.until) {
      window = { until: now + limits.windowMs, count: 0 };
      windows.set(name, window);
    }
    window.count += 1;
    return window.count <= limits[name];
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (req.headers.host !== canonicalHost) throw new StudyError('请通过本机知芽地址打开。', 403, 'invalid_host');
      if (req.headers.origin && req.headers.origin !== origin) throw new StudyError('此请求来自其他网页，已拒绝。', 403, 'invalid_origin');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new StudyError('不允许其他网站访问本机助手。', 403, 'cross_site');
      if (req.headers['access-control-request-method']) throw new StudyError('不允许跨域访问本机助手。', 403, 'cross_origin');
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new StudyError('请求地址有误。', 400, 'invalid_url');
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (!allowRequest('api')) {
          res.setHeader('Retry-After', String(Math.ceil(limits.windowMs / 1000)));
          throw new StudyError('请求太频繁，请稍等一分钟再试。', 429, 'rate_limited');
        }
        if (req.method !== 'GET' && req.method !== 'POST') throw new StudyError('此请求方式不支持。', 405, 'method');
        if (req.method === 'POST') {
          // Fetch sends Origin for same-origin POST. Requiring it also prevents form/CSRF requests.
          if (req.headers.origin !== origin || !secretEquals(req.headers['x-study-token'], token)) throw new StudyError('连接校验失败，请刷新本机知芽页面重试。', 403, 'invalid_token');
        }
        if (pathname === '/api/codex/session' && req.method === 'GET') return replyJson(res, 200, { token });
        if (pathname === '/api/codex/status' && req.method === 'GET') return replyJson(res, 200, await codex.status());
        if (pathname === '/api/codex/cancel' && req.method === 'POST') {
          const body = await readJson(req);
          if (typeof body.conversationId !== 'string' || body.conversationId.length > 100) throw new StudyError('对话标识有误。', 400, 'conversation');
          return replyJson(res, 200, { cancelled: codex.cancel(body.conversationId) });
        }
        if (pathname === '/api/codex/chat' && req.method === 'POST') {
          const body = await readJson(req);
          if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 16000) throw new StudyError('请输入问题，最多 16000 字。', 400, 'message');
          if (body.context !== undefined && (typeof body.context !== 'string' || body.context.length > 12000)) throw new StudyError('学习背景太长，请缩短后再试。', 400, 'context');
          if (body.conversationId !== undefined && (typeof body.conversationId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.conversationId))) throw new StudyError('对话标识有误，请新建对话。', 400, 'conversation');
          if (codex.busy) throw new StudyError('学习教练正在回答，请稍等或停止当前回答。', 409, 'busy');
          if (!allowRequest('chat')) {
            res.setHeader('Retry-After', String(Math.ceil(limits.windowMs / 1000)));
            throw new StudyError('提问太频繁，请稍等一分钟再试。', 429, 'rate_limited');
          }
          await codex.authorize();
          if (codex.busy) throw new StudyError('学习教练正在回答，请稍等或停止当前回答。', 409, 'busy');
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
          let conversationId = body.conversationId;
          const emit = (event) => {
            if (event.type === 'conversation') conversationId = event.conversationId;
            if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
          };
          res.on('close', () => { if (!res.writableEnded && conversationId) codex.cancel(conversationId); });
          try { await codex.chat({ message: body.message.trim(), context: body.context || '', conversationId: body.conversationId }, emit); }
          catch (error) { emit({ type: 'error', message: error instanceof StudyError ? error.message : '本机助手暂时无法回答，请稍后重试。' }); }
          if (!res.destroyed && !res.writableEnded) res.end();
          return;
        }
        if (['/api/codex/session', '/api/codex/status', '/api/codex/chat', '/api/codex/cancel'].includes(pathname)) throw new StudyError('此请求方式不支持。', 405, 'method');
        throw new StudyError('找不到这个接口。', 404, 'not_found');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new StudyError('此请求方式不支持。', 405, 'method');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw new StudyError('请求地址有误。', 400, 'invalid_path'); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((part) => part === '..' || part.startsWith('.'))) throw new StudyError('找不到这个文件。', 404, 'not_found');
      const file = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new StudyError('找不到这个文件。', 404, 'not_found');
      let resolved;
      let info;
      try { resolved = await realpath(file); info = await stat(resolved); } catch { throw new StudyError('找不到这个文件。', 404, 'not_found'); }
      const realRoot = await realpath(root);
      if ((!resolved.startsWith(`${realRoot}${path.sep}`) && resolved !== realRoot) || !info.isFile()) throw new StudyError('找不到这个文件。', 404, 'not_found');
      const contentType = MIME[path.extname(resolved).toLowerCase()];
      if (!contentType) throw new StudyError('不支持这个文件类型。', 404, 'not_found');
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(resolved);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      replyJson(res, error instanceof StudyError ? error.status : 500, { error: error instanceof StudyError ? error.message : '本机知芽遇到问题，请刷新后重试。' });
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  server.maxConnections = 32;
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('close', () => codex.close());

  return {
    server, client: codex,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          canonicalHost = `127.0.0.1:${server.address().port}`;
          origin = `http://${canonicalHost}`;
          resolve();
        });
      });
      return origin;
    },
    async close() {
      codex.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createStudyServer();
  app.listen().then((origin) => {
    console.log(`知芽私人学习站已启动：${origin}`);
    console.log('仅本机可访问；Codex 登录信息保留在这台电脑。关闭此进程即可停止。');
  }).catch((error) => {
    console.error(error.code === 'EADDRINUSE' ? '本机 4175 端口已被占用，请先关闭旧的知芽服务。' : '知芽无法启动，请检查本机环境。');
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
