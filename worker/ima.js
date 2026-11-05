// Included in the owner-authenticated Sites Worker. Credentials stay in runtime secrets.
const IMA_SETUP_URL = 'https://ima.qq.com/agent-interface';
const IMA_MAX_BODY = 196608;
const IMA_ROUTES = new Set(['status', 'libraries', 'search', 'save-note']);
function imaConfigured(env) {
  return ['IMA_OPENAPI_CLIENTID', 'IMA_OPENAPI_APIKEY'].every(key => typeof env[key] === 'string' && env[key].trim().length > 0 && env[key].length <= 4096 && !/[\r\n]/.test(env[key]));
}
function imaString(value, maximum, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new HttpError(400, 'invalid_ima_input', 'ima 请求内容不完整或超过长度限制。');
  // TextEncoder replaces unpaired surrogates. Check the round trip before any note write.
  if (new TextDecoder('utf-8', {fatal: true}).decode(new TextEncoder().encode(value)) !== value) throw new HttpError(400, 'invalid_ima_utf8', '文字包含无效字符，请重新粘贴后再保存。');
  return value;
}
function imaId(value) {
  const id = imaString(value, 512);
  if (/\s/.test(id)) throw new HttpError(400, 'invalid_ima_id', '请选择有效的 ima 知识库。');
  return id;
}
async function imaReadBody(request) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'json_required', '请使用网页中的资料操作。');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > IMA_MAX_BODY)) throw new HttpError(413, 'ima_body_too_large', '单篇资料过长，请拆分后保存。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_json', '没有收到资料内容。');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > IMA_MAX_BODY) {await reader.cancel(); throw new HttpError(413, 'ima_body_too_large', '单篇资料过长，请拆分后保存。');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of chunks) {bytes.set(part, offset); offset += part.byteLength;}
  try {
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (_) {throw new HttpError(400, 'invalid_json', '资料格式有误，未写入 ima。');}
}
function imaScope(body, url, allowed) {
  const expected = new Set(['roleId', 'profileId', ...allowed]);
  if (Object.keys(body).some(key => !expected.has(key)) || !['apple', 'sheep', 'bear'].includes(body.roleId) || !['product', 'coding', 'fde', 'custom', 'mobile'].includes(body.profileId)) throw new HttpError(400, 'invalid_ima_scope', '请选择当前角色和学习方向后再操作。');
  const queryRoles = url.searchParams.getAll('role');
  if (queryRoles.length > 1 || queryRoles.length === 1 && queryRoles[0] !== body.roleId) throw new HttpError(400, 'role_mismatch', '当前角色与资料操作不一致，请刷新后重试。');
  return {roleId: body.roleId, profileId: body.profileId};
}
function imaText(value, max = 512) {
  let text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text;
}
function imaPlain(value, max = 1600) {
  return imaText(value, max * 3).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, entity => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' '}[entity])).slice(0, max);
}
function imaSafeMessage(value, env) {
  let message = imaPlain(value, 240);
  for (const secret of [env.IMA_OPENAPI_CLIENTID, env.IMA_OPENAPI_APIKEY]) if (secret) {message = message.split(secret).join('[已隐藏]'); if (secret.trim()) message = message.split(secret.trim()).join('[已隐藏]');}
  return message || 'ima 暂时无法处理这个请求。';
}
function imaRemoteError(message, uncertain = false) {
  const error = new Error(message); error.imaRemote = true; error.uncertain = uncertain; return error;
}
async function imaPost(env, path, body) {
  // No configurable URL and no redirect following: API credentials only reach ima.qq.com.
  const endpoints = new Set(['wiki/v1/get_addable_knowledge_base_list', 'wiki/v1/search_knowledge', 'wiki/v1/get_knowledge_list', 'note/v1/import_doc', 'wiki/v1/add_knowledge']);
  if (!endpoints.has(path)) throw new HttpError(400, 'invalid_ima_operation', '没有这项 ima 操作。');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://ima.qq.com/openapi/' + path, {method: 'POST', redirect: 'error', signal: controller.signal, headers: {'Content-Type': 'application/json; charset=utf-8', 'ima-openapi-clientid': env.IMA_OPENAPI_CLIENTID.trim(), 'ima-openapi-apikey': env.IMA_OPENAPI_APIKEY.trim()}, body: JSON.stringify(body)});
    if (response.status === 401) throw imaRemoteError('ima 授权验证未通过，请在官方入口更新连接凭证。');
    if (response.status === 403) throw imaRemoteError('当前 ima 账号没有这项操作权限，请检查知识库授权。');
    if (response.status === 429) throw imaRemoteError('ima 请求过于频繁，请稍后手动重试。');
    if (!response.ok) throw imaRemoteError('ima 暂时无法连接，未自动重试。', true);
    const reader = response.body?.getReader();
    if (!reader) throw imaRemoteError('ima 没有返回有效结果，未自动重试。', true);
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 524288) {await reader.cancel(); throw imaRemoteError('ima 返回内容过大，请缩小查询范围。', true);}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    let payload;
    try {payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch (_) {throw imaRemoteError('ima 返回格式有误，未自动重试。', true);}
    if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'code')) throw imaRemoteError('ima 返回格式有误，未自动重试。', true);
    if (payload.code !== 0) throw imaRemoteError('ima 返回：' + imaSafeMessage(payload.msg, env));
    return payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
  } catch (error) {
    if (error.imaRemote || error instanceof HttpError) throw error;
    throw imaRemoteError('ima 连接超时或网络暂时不可用，未自动重试。', true);
  } finally {clearTimeout(timeout);}
}
function imaPage(data) {
  return {nextCursor: imaText(data.next_cursor, 4096), isEnd: data.is_end === true || !data.next_cursor};
}
function imaNoteContent(title, content) {
  let removed = 0;
  let markdown = content.replace(/!\[[^\]\n]*\]\(([^)\n]*)\)/g, (whole, target) => {
    if (/^\s*<?https?:\/\//i.test(target)) return whole;
    removed++; return '';
  }).replace(/<img\b[^>]*>/gi, whole => {
    const source = whole.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
    if (source && /^https?:\/\//i.test(source[1])) return whole;
    removed++; return '';
  });
  const safeTitle = title.trim().replace(/[\r\n]+/g, ' ');
  markdown = '# ' + safeTitle + '\n\n' + markdown.trim();
  imaString(markdown, 61000);
  if (new TextEncoder().encode(markdown).byteLength > 184320) throw new HttpError(413, 'ima_body_too_large', '单篇资料过长，请拆分后保存。');
  return {markdown, warnings: removed ? ['ima 笔记不支持本地图片，已从本次导出的内容中移除 ' + removed + ' 处；网页内原资料保留。'] : []};
}
async function imaApi(request, env, id, url) {
  const operation = url.pathname.slice('/api/ima/'.length);
  if (!IMA_ROUTES.has(operation)) return json({code: 'not_found', error: '没有这项 ima 操作。'}, 404);
  const method = operation === 'status' ? 'GET' : 'POST';
  if (request.method !== method) return json({code: 'method_not_allowed', error: '请使用资料库中的 ima 操作。'}, 405, {Allow: method});
  sameOrigin(request, request.method === 'POST');
  if (!id) throw new HttpError(401, 'login_required', '请先登录你的私人学习空间。');
  if (operation === 'status') {
    studyRole(url);
    return json({configured: imaConfigured(env), provider: 'ima', setupUrl: IMA_SETUP_URL});
  }
  const body = await imaReadBody(request);
  const scope = imaScope(body, url, operation === 'libraries' ? ['cursor'] : operation === 'search' ? ['kbId', 'query', 'cursor'] : ['kbId', 'title', 'content']);
  if (!imaConfigured(env)) return json({code: 'ima_not_configured', error: 'ima 连接尚未配置。网页内的资料仍可保存和导出。', configured: false, setupUrl: IMA_SETUP_URL}, 503);
  let noteId = '', writeStarted = false;
  try {
    if (operation === 'libraries') {
      const data = await imaPost(env, 'wiki/v1/get_addable_knowledge_base_list', {cursor: imaString(body.cursor ?? '', 4096, true), limit: 20});
      const list = Array.isArray(data.addable_knowledge_base_list) ? data.addable_knowledge_base_list : [];
      return json({configured: true, ...scope, libraries: list.slice(0, 20).filter(item => item && typeof item.id === 'string').map(item => ({id: imaText(item.id), name: imaText(item.name, 180)})), ...imaPage(data)});
    }
    const kbId = imaId(body.kbId);
    if (operation === 'search') {
      const query = imaString(body.query ?? '', 200, true).trim(), cursor = imaString(body.cursor ?? '', 4096, true);
      const data = await imaPost(env, query ? 'wiki/v1/search_knowledge' : 'wiki/v1/get_knowledge_list', {knowledge_base_id: kbId, cursor, ...(query ? {query} : {limit: 20})});
      const list = query ? data.info_list : data.knowledge_list;
      return json({...scope, kbId, results: (Array.isArray(list) ? list : []).slice(0, 20).filter(item => item && typeof item.media_id === 'string').map(item => ({id: imaText(item.media_id), title: imaText(item.title, 240), content: imaPlain(item.highlight_content || item.summary || '', 1600)})), ...imaPage(data)});
    }
    const title = imaString(body.title, 180), content = imaString(body.content, 60000);
    const prepared = imaNoteContent(title, content);
    writeStarted = true;
    const created = await imaPost(env, 'note/v1/import_doc', {content_format: 1, content: prepared.markdown});
    if (typeof created.note_id !== 'string' || !created.note_id || created.note_id.length > 512 || /\s/.test(created.note_id)) throw imaRemoteError('笔记可能已新建，但 ima 未返回有效标识。请先到 ima 确认，避免重复创建。', true);
    noteId = created.note_id;
    await imaPost(env, 'wiki/v1/add_knowledge', {media_type: 11, note_info: {content_id: noteId}, title: title.trim().replace(/[\r\n]+/g, ' '), knowledge_base_id: kbId});
    return json({...scope, saved: true, noteId, kbId, warnings: prepared.warnings});
  } catch (error) {
    if (!error.imaRemote) throw error;
    const mayHaveSaved = Boolean(noteId || writeStarted && error.uncertain);
    return json({code: 'ima_upstream_error', error: mayHaveSaved ? error.message + ' 请先到 ima 查看笔记；本次没有自动重试。' : error.message, ...scope, ...(noteId ? {noteId, noteCreated: true} : {}), mayHaveSaved, retryable: false}, 502);
  }
}
