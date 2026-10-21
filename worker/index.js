// Sites supplies verified visitor identity at the deployment boundary. No service-token bypass.
const MAX_BODY = 2_000_000;
const PROFILE_IDS = ['product', 'coding', 'custom', 'fde'];
const APP_KEYS = ['version', 'profile', 'goals', 'completed', 'tasks', 'notes', 'reviews', 'projectTasks', 'boundaries', 'minutes', 'day', 'timer', 'frameworks', 'materials', 'imaTargets'];
const ICON_NAMES = ['garden', 'map', 'book', 'project', 'spark', 'shelf', 'arrow', 'check', 'clock', 'github', 'target', 'copy', 'plus', 'download'];
const IDENTITY = {verified: true, owner: true};
const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://chatgpt.site https://*.chatgpt.site; upgrade-insecure-requests",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = () => {throw new HttpError(400, 'invalid_snapshot', '学习记录格式不正确，未修改云端记录。');};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function keys(value, allowed, required = []) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) invalid();
}
function boundedTree(value, depth = 0, budget = {n: 0}) {
  if (depth > 16 || ++budget.n > 30_000) invalid();
  if (typeof value === 'string' && value.length > 20_000) invalid();
  if (typeof value === 'number' && !Number.isFinite(value)) invalid();
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
    if (Object.keys(value).length > 500) invalid();
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
      boundedTree(value[key], depth + 1, budget);
    }
  } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) invalid();
}
function validText(value, limit) {if (typeof value !== 'string' || value.length > limit) invalid();}
function validateApp(raw) {
  keys(raw, APP_KEYS, APP_KEYS.filter(key => !['frameworks', 'materials', 'imaTargets'].includes(key)));
  if (raw.version !== 1 || !PROFILE_IDS.includes(raw.profile) || !integer(raw.minutes, 15, 180) || !integer(raw.day, 0, 9)) invalid();
  for (const name of ['goals', 'completed', 'tasks', 'notes', 'projectTasks', 'boundaries']) {
    if (!object(raw[name]) || Object.keys(raw[name]).length > 200) invalid();
    for (const [key, value] of Object.entries(raw[name])) {
      if (key.length < 1 || key.length > 200) invalid();
      if (['completed', 'tasks', 'projectTasks'].includes(name)) {if (typeof value !== 'boolean') invalid();}
      else if (name === 'notes') validText(value, 20_000);
      else if (name === 'goals') {
        if (!PROFILE_IDS.includes(key)) invalid();
        keys(value, ['goal', 'why', 'outcome', 'level']);
        for (const text of Object.values(value)) validText(text, 3000);
      } else {
        if (!PROFILE_IDS.includes(key)) invalid();
        keys(value, ['must', 'optional', 'later'], ['must', 'optional', 'later']);
        for (const items of Object.values(value)) {
          if (!Array.isArray(items) || items.length > 15) invalid();
          for (const text of items) validText(text, 300);
        }
      }
    }
  }
  if (!Array.isArray(raw.reviews) || raw.reviews.length > 100) invalid();
  for (const review of raw.reviews) {
    keys(review, ['date', 'text', 'profile'], ['date', 'text', 'profile']);
    validText(review.date, 40); validText(review.text, 3000);
    if (!PROFILE_IDS.includes(review.profile)) invalid();
  }
  keys(raw.timer, ['remaining', 'deadline'], ['remaining', 'deadline']);
  if (!integer(raw.timer.remaining, 0, 1500) || !(raw.timer.deadline === null || integer(raw.timer.deadline, 0, 8_640_000_000_000_000))) invalid();
  const frameworks = raw.frameworks === undefined ? {} : raw.frameworks;
  keys(frameworks, PROFILE_IDS);
  const cleanFrameworks = {};
  for (const [profileId, framework] of Object.entries(frameworks)) {
    keys(framework, ['nodes', 'summary', 'updatedAt'], ['nodes', 'summary', 'updatedAt']);
    validText(framework.summary, 2000);
    if (!integer(framework.updatedAt, 0, 8_640_000_000_000_000) || !Array.isArray(framework.nodes) || framework.nodes.length !== 6) invalid();
    const nodes = framework.nodes.map(node => {
      if (!Array.isArray(node) || node.length !== 5) invalid();
      [120, 500, 2000, 2000, 30].forEach((limit, i) => {validText(node[i], limit); if (!node[i].trim()) invalid();});
      if (!ICON_NAMES.includes(node[4])) invalid();
      return node.map(text => text.trim());
    });
    cleanFrameworks[profileId] = {nodes, summary: framework.summary, updatedAt: framework.updatedAt};
  }
  const materials = raw.materials === undefined ? [] : raw.materials;
  if (!Array.isArray(materials) || materials.length > 80) invalid();
  const materialIds = new Set();
  for (const m of materials) {
    const fields = ['id', 'profileId', 'nodeIndex', 'type', 'title', 'content', 'url', 'createdAt', 'updatedAt'];
    keys(m, fields, fields);
    if (typeof m.id !== 'string' || !/^mat-[A-Za-z0-9_-]{1,70}$/.test(m.id) || materialIds.has(m.id) || !PROFILE_IDS.includes(m.profileId) || !(m.nodeIndex === null || integer(m.nodeIndex, 0, 5)) || !['note', 'link', 'file'].includes(m.type)) invalid();
    validText(m.title, 300); validText(m.content, 10000); validText(m.url, 2000);
    if (!m.title.trim() || !(m.content.trim() || m.url) || m.type === 'link' && !m.url) invalid();
    if (m.url) { let u; try { u = new URL(m.url); } catch (_) { invalid(); } if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) invalid(); }
    if (!integer(m.createdAt, 0, 8_640_000_000_000_000) || !integer(m.updatedAt, m.createdAt, 8_640_000_000_000_000)) invalid();
    materialIds.add(m.id);
  }
  const imaTargets = raw.imaTargets === undefined ? {} : raw.imaTargets;
  keys(imaTargets, PROFILE_IDS);
  for (const target of Object.values(imaTargets)) { keys(target, ['id', 'name'], ['id', 'name']); validText(target.id, 500); validText(target.name, 300); if (!target.id.trim()) invalid(); }
  return JSON.parse(JSON.stringify({...raw, frameworks: cleanFrameworks, materials, imaTargets}));
}

/*__LEARNING_VALIDATOR__*/

export function validateSnapshot(raw) {
  boundedTree(raw);
  keys(raw, ['app', 'learning'], ['app', 'learning']);
  const app = validateApp(raw.app);
  try {return {app, learning: validateLearningSnapshot(raw.learning)};} catch (_) {invalid();}
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {status, headers: {...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra}});
}
async function identify(request, env) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id || !email || id.length > 256 || email.length > 320 || /[\u0000-\u0020\u007f]/.test(id)) throw new HttpError(401, 'login_required', '请使用你的 ChatGPT 账号登录后继续。');
  const expected = env.STUDY_OWNER_EMAIL_SHA256;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new HttpError(503, 'owner_not_configured', '私人空间的账号校验尚未配置，请稍后重试。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (difference !== 0) throw new HttpError(403, 'owner_mismatch', '这里只允许所有者账号使用，请切换为你自己的账号。');
  return id;
}
function studyRole(url) {
  const values = url.searchParams.getAll('role');
  if (values.length > 1 || values.length === 1 && !['apple', 'sheep', 'bear'].includes(values[0])) throw new HttpError(400, 'invalid_role', '请选择小貅、小羊或小熊。');
  return values[0] || 'apple';
}
function roleStorageKey(id, roleId) {
  // Verified identity excludes control characters; this internal suffix cannot collide with a real user id.
  return roleId === 'apple' ? id : id + '\u001frole:' + roleId;
}
function sameOrigin(request, requireOrigin = false) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if ((requireOrigin && !origin) || (origin && origin !== new URL(request.url).origin) || (site && !['same-origin', 'none'].includes(site))) throw new HttpError(403, 'origin_rejected', '请从你的私人学习网站内操作。');
}
async function readBody(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(contentType)) throw new HttpError(415, 'json_required', '请提交 JSON 格式的学习记录。');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) throw new HttpError(413, 'body_too_large', '学习记录超过 2 MB，请先导出备份并整理笔记。');
  const chunks = [], reader = request.body?.getReader();
  let size = 0;
  if (!reader) throw new HttpError(400, 'invalid_json', '没有收到学习记录。');
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {await reader.cancel(); throw new HttpError(413, 'body_too_large', '学习记录超过 2 MB，请先导出备份并整理笔记。');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
  catch (_) {throw new HttpError(400, 'invalid_json', '学习记录不是有效的 JSON，未修改云端记录。');}
}
async function readState(db, id) {
  return db.prepare('SELECT revision, snapshot, updated_at FROM study_states WHERE owner_id = ?').bind(id).first();
}
function publicState(row, roleId) {
  return {roleId, revision: row?.revision || 0, state: row ? JSON.parse(row.snapshot) : null, updatedAt: row?.updated_at || null, identity: IDENTITY};
}
async function stateApi(request, env, id, roleId) {
  sameOrigin(request, request.method === 'PUT');
  if (!env.DB?.prepare) throw new HttpError(503, 'storage_unavailable', '云端学习记录暂时不可用，当前浏览器的记录仍会保留。');
  if (request.method === 'GET') return json(publicState(await readState(env.DB, id), roleId));
  if (request.method !== 'PUT') return json({code: 'method_not_allowed', error: '此接口仅支持读取或保存学习记录。'}, 405, {Allow: 'GET, PUT'});
  const body = await readBody(request);
  boundedTree(body);
  keys(body, ['roleId', 'baseRevision', 'snapshot'], ['baseRevision', 'snapshot']);
  // Older pages omit roleId; current pages bind the body to their selected partition too.
  if (own(body, 'roleId') && body.roleId !== roleId) throw new HttpError(400, 'role_mismatch', '当前角色与提交记录不一致，未修改云端记录。');
  if (!integer(body.baseRevision, 0, Number.MAX_SAFE_INTEGER - 1)) invalid();
  const snapshot = validateSnapshot(body.snapshot);
  const serialized = JSON.stringify(snapshot), now = new Date().toISOString();
  const row = body.baseRevision === 0
    ? await env.DB.prepare('INSERT INTO study_states (owner_id, revision, snapshot, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (owner_id) DO NOTHING RETURNING revision, snapshot, updated_at').bind(id, serialized, now).first()
    : await env.DB.prepare('UPDATE study_states SET revision = revision + 1, snapshot = ?, updated_at = ? WHERE owner_id = ? AND revision = ? RETURNING revision, snapshot, updated_at').bind(serialized, now, id, body.baseRevision).first();
  if (!row) return json({...publicState(await readState(env.DB, id), roleId), code: 'revision_conflict', error: '另一处已更新学习记录，请先选择保留哪份记录。'}, 409);
  return json(publicState(row, roleId));
}

/*__MEMBERSHIP_BRIDGE__*/

/*__IMA_CONNECTOR__*/
/*__STATIC_ASSETS__*/

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/bridge/')) return await bridgeServiceApi(request, env, url);
      const id = await identify(request, env);
      if (url.pathname.startsWith('/api/ima/')) return await imaApi(request, env, id, url);
      if (url.pathname.startsWith('/api/codex/')) return await membershipApi(request, env, id, url);
      if (url.pathname === '/api/study/state') {
        const roleId = studyRole(url);
        return await stateApi(request, env, roleStorageKey(id, roleId), roleId);
      }
      if (url.pathname.startsWith('/api/')) return json({code: 'not_found', error: '没有这个学习接口。'}, 404);
      if (!['GET', 'HEAD'].includes(request.method)) return json({code: 'method_not_allowed', error: '此页面仅支持浏览。'}, 405, {Allow: 'GET, HEAD'});
      const asset = STATIC_ASSETS[url.pathname === '/' ? '/index.html' : url.pathname];
      if (!asset) return new Response('页面不存在', {status: 404, headers: SECURITY_HEADERS});
      const body = request.method === 'HEAD' ? null : asset.encoding === 'base64' ? Uint8Array.from(atob(asset.body), character => character.charCodeAt(0)) : asset.body;
      return new Response(body, {headers: {...SECURITY_HEADERS, 'Content-Type': asset.type}});
    } catch (error) {
      if (error instanceof HttpError) return json({code: error.code, error: error.message}, error.status);
      // Do not disclose database details, identity headers, or learning records in errors.
      return json({code: 'storage_unavailable', error: '云端暂时无法保存或读取，请保留本机记录后稍后再试。'}, 503);
    }
  }
};
