// Private Sites transports learning requests to an owner-verified local Codex.
// No OpenAI API key, account password, or Codex login token enters this Worker.
/*__BRIDGE_TOOL_DEFINITIONS__*/
const BRIDGE_TTL = 20 * 60 * 1000;
const BRIDGE_TURN_LIMIT = 180000;
const bridgeNonce = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const bridgeId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const bridgeFault = (status, code, message) => { throw new HttpError(status, code, message); };
function bridgeScope(body) {
  if (!object(body) || !['apple', 'sheep'].includes(body.roleId) || !PROFILE_IDS.includes(body.profileId)) bridgeFault(400, 'invalid_scope', '角色或学习方向无效，请刷新后重试。');
}
async function bridgeBody(request) {
  const body = await readBody(request);
  boundedTree(body);
  if (JSON.stringify(body).length > 131072) bridgeFault(413, 'body_too_large', '这次内容太长，请拆成较小的问题。');
  return body;
}
function bridgeDatabase(env) {
  if (!env.DB?.prepare) bridgeFault(503, 'bridge_unavailable', '会员连接暂时不可用，学习记录和测验仍可使用。');
  return env.DB;
}
async function bridgeAuthenticate(request, env) {
  const key = request.headers.get('X-Study-Bridge-Key');
  if (!bridgeNonce(key) || !/^[a-f0-9]{64}$/.test(env.STUDY_BRIDGE_KEY_SHA256 || '')) bridgeFault(403, 'bridge_forbidden', '连接服务校验失败。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== env.STUDY_BRIDGE_KEY_SHA256) bridgeFault(403, 'bridge_forbidden', '连接服务校验失败。');
  // Dispatch independently validates OAI-Sites-Authorization on this owner-private Site.
  // This second secret grants only the bounded relay endpoints, never study-state access.
}
async function bridgeCleanup(db, now) {
  await db.prepare('DELETE FROM membership_bridge_tools WHERE job_id IN (SELECT id FROM membership_bridge_jobs WHERE expires_at < ?)').bind(now).run();
  await db.prepare('DELETE FROM membership_bridge_events WHERE job_id IN (SELECT id FROM membership_bridge_jobs WHERE expires_at < ?)').bind(now).run();
  await db.prepare('DELETE FROM membership_bridge_jobs WHERE expires_at < ?').bind(now).run();
  await db.prepare("UPDATE membership_bridge_jobs SET status = 'cancelled', updated_at = ? WHERE status IN ('queued','running') AND created_at < ?").bind(now, now - BRIDGE_TURN_LIMIT).run();
}
async function membershipStatus(db) {
  const row = await db.prepare("SELECT status_json, updated_at FROM membership_bridge_state WHERE id = 'owner'").first();
  const fresh = row && Date.now() - row.updated_at < 30000;
  const saved = fresh ? JSON.parse(row.status_json) : {};
  const authenticated = Boolean(fresh && saved.available && saved.authenticated);
  return {available: Boolean(fresh && saved.available), authenticated, ownerVerified: authenticated, busy: Boolean(fresh && saved.busy), model: typeof saved.model === 'string' ? saved.model : '', modelNotice: typeof saved.modelNotice === 'string' ? saved.modelNotice : '', mode: 'membership', message: authenticated ? '已连接你的 Codex 会员，连接电脑需保持开机。' : '会员连接电脑未运行或尚未完成本人登录；学习记录和测验仍可使用。'};
}
async function bridgeLease(db, body) {
  if (!bridgeId(body.jobId) || !bridgeNonce(body.leaseToken)) bridgeFault(400, 'invalid_job', '任务标识无效。');
  const job = await db.prepare('SELECT * FROM membership_bridge_jobs WHERE id = ? AND lease_token = ?').bind(body.jobId, body.leaseToken).first();
  if (!job || job.expires_at < Date.now()) bridgeFault(404, 'job_expired', '这次任务已结束。');
  return job;
}
async function bridgeServiceApi(request, env, url) {
  await bridgeAuthenticate(request, env);
  if (request.method !== 'POST') bridgeFault(405, 'method_not_allowed', '连接服务只接受 POST。');
  const db = bridgeDatabase(env), body = await bridgeBody(request), now = Date.now();
  if (url.pathname === '/api/bridge/status') {keys(body, []); return json(await membershipStatus(db));}
  if (url.pathname === '/api/bridge/heartbeat') {
    keys(body, ['available','authenticated','ownerVerified','model','modelNotice','busy']);
    if (typeof body.available !== 'boolean' || typeof body.authenticated !== 'boolean' || typeof body.busy !== 'boolean') bridgeFault(400, 'invalid_status', '连接状态格式无效。');
    for (const key of ['model','modelNotice']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 500)) bridgeFault(400, 'invalid_status', '连接状态格式无效。');
    const safe = {available: body.available, authenticated: body.authenticated && body.ownerVerified !== false, model: body.model || '', modelNotice: body.modelNotice || '', busy: body.busy};
    await db.prepare("INSERT INTO membership_bridge_state (id,status_json,updated_at) VALUES ('owner',?,?) ON CONFLICT(id) DO UPDATE SET status_json=excluded.status_json,updated_at=excluded.updated_at").bind(JSON.stringify(safe), now).run();
    await bridgeCleanup(db, now);
    return json({ok: true});
  }
  if (url.pathname === '/api/bridge/claim') {
    keys(body, []);
    if (!(await membershipStatus(db)).authenticated) return json({job: null});
    const leaseToken = crypto.randomUUID();
    const job = await db.prepare("UPDATE membership_bridge_jobs SET status='running',lease_token=?,updated_at=? WHERE id=(SELECT id FROM membership_bridge_jobs WHERE status='queued' AND created_at > ? ORDER BY created_at,id LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM membership_bridge_jobs WHERE status='running' AND created_at > ?) RETURNING *").bind(leaseToken, now, now - BRIDGE_TURN_LIMIT, now - BRIDGE_TURN_LIMIT).first();
    return json({job: job ? {...JSON.parse(job.request_json), id: job.id, leaseToken, toolDefinitions: BRIDGE_TOOL_DEFINITIONS} : null});
  }
  if (url.pathname === '/api/bridge/events') {
    keys(body, ['jobId','leaseToken','events'], ['jobId','leaseToken','events']);
    const job = await bridgeLease(db, body);
    if (job.status !== 'running') return json({ok: false, cancelled: true});
    if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50) bridgeFault(400, 'invalid_events', '任务事件格式无效。');
    const last = await db.prepare('SELECT MAX(seq) AS seq FROM membership_bridge_events WHERE job_id = ?').bind(job.id).first();
    let expected = (last?.seq || 0) + 1;
    for (const raw of body.events) {
      if (!object(raw) || !integer(raw.seq, 1, 10000) || !['conversation','delta','tool_call','error','done'].includes(raw.type)) bridgeFault(400, 'invalid_event', '任务事件无效。');
      const event = {...raw, jobId: job.id, roleId: job.role_id, profileId: job.profile_id};
      if (JSON.stringify(event).length > 65536) bridgeFault(413, 'event_too_large', '回复片段过长。');
      if (raw.type === 'delta' && (typeof raw.text !== 'string' || raw.text.length > 20000)) bridgeFault(400, 'invalid_event', '回复片段无效。');
      if (raw.type === 'error' && (typeof raw.message !== 'string' || raw.message.length > 2000)) bridgeFault(400, 'invalid_event', '回复错误格式无效。');
      if (raw.type === 'conversation' && !bridgeId(raw.conversationId)) bridgeFault(400, 'invalid_event', '对话标识无效。');
      if (raw.type === 'tool_call' && (!bridgeNonce(raw.nonce) || typeof raw.callId !== 'string' || raw.callId.length > 160 || !raw.callId || !BRIDGE_TOOL_DEFINITIONS.some(def => def.name === raw.name) || !object(raw.arguments) || raw.roleId !== job.role_id || raw.profileId !== job.profile_id || !bridgeId(raw.conversationId))) bridgeFault(400, 'invalid_tool', '学习工具请求无效。');
      const serialized = JSON.stringify(event);
      if (raw.seq < expected) {
        const old = await db.prepare('SELECT event_json FROM membership_bridge_events WHERE job_id = ? AND seq = ?').bind(job.id, raw.seq).first();
        if (!old || old.event_json !== serialized) bridgeFault(409, 'event_conflict', '任务片段与已接收内容不一致。');
        continue;
      }
      if (raw.seq !== expected++) bridgeFault(409, 'event_order', '任务片段顺序不一致。');
      if (raw.type === 'tool_call') await db.prepare('INSERT INTO membership_bridge_tools (job_id,call_id,nonce) VALUES (?,?,?) ON CONFLICT(job_id,call_id) DO NOTHING').bind(job.id, raw.callId, raw.nonce).run();
      await db.prepare('INSERT INTO membership_bridge_events (job_id,seq,event_json) VALUES (?,?,?)').bind(job.id, raw.seq, serialized).run();
      if (raw.type === 'conversation') await db.prepare('UPDATE membership_bridge_jobs SET conversation_id = ? WHERE id = ?').bind(raw.conversationId, job.id).run();
      if (raw.type === 'done' || raw.type === 'error') await db.prepare("UPDATE membership_bridge_jobs SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'").bind(raw.type === 'done' ? 'done' : 'failed', now, job.id).run();
    }
    return json({ok: true, seq: expected - 1});
  }
  if (url.pathname === '/api/bridge/control') {
    keys(body, ['jobId','leaseToken','callIds'], ['jobId','leaseToken']);
    const job = await bridgeLease(db, body);
    if (body.callIds !== undefined && (!Array.isArray(body.callIds) || body.callIds.length > 30 || body.callIds.some(value => typeof value !== 'string' || !value || value.length > 160))) bridgeFault(400, 'invalid_control', '待处理工具列表无效。');
    const filter = body.callIds === undefined ? '' : body.callIds.length ? ' AND call_id IN (' + body.callIds.map(() => '?').join(',') + ')' : ' AND 0';
    const results = await db.prepare('SELECT call_id, nonce, result_json FROM membership_bridge_tools WHERE job_id = ? AND result_json IS NOT NULL' + filter + ' LIMIT 1').bind(job.id, ...(body.callIds || [])).all();
    return json({cancelled: job.status === 'cancelled' || job.created_at < now - BRIDGE_TURN_LIMIT, results: results.results.map(row => ({callId: row.call_id, nonce: row.nonce, result: JSON.parse(row.result_json)}))});
  }
  bridgeFault(404, 'not_found', '没有这个连接接口。');
}
async function membershipJob(db, id, roleId, profileId, jobId, conversationId) {
  if (jobId !== undefined && !bridgeId(jobId) || conversationId !== undefined && !bridgeId(conversationId)) bridgeFault(400, 'invalid_job', '任务标识无效。');
  if (!jobId && !conversationId) bridgeFault(400, 'invalid_job', '请提供当前任务。');
  const job = await db.prepare('SELECT * FROM membership_bridge_jobs WHERE owner_id = ? AND role_id = ? AND profile_id = ? AND ' + (jobId ? 'id = ?' : 'conversation_id = ?') + ' ORDER BY created_at DESC LIMIT 1').bind(id, roleId, profileId, jobId || conversationId).first();
  if (!job || job.expires_at < Date.now()) bridgeFault(404, 'job_expired', '当前角色的任务已结束，请重新提问。');
  return job;
}
function membershipStream(db, job, request) {
  const encode = new TextEncoder();
  let stopped = false;
  const cancel = async () => { if (stopped) return; stopped = true; await db.prepare("UPDATE membership_bridge_jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running')").bind(Date.now(), job.id).run(); };
  const stream = new ReadableStream({
    start(controller) {
      const emit = event => {if (!stopped) controller.enqueue(encode.encode(JSON.stringify(event) + '\n'));};
      request.signal.addEventListener('abort', () => {void cancel();}, {once: true});
      void (async () => {
        let cursor = 0;
        emit({type: 'job', jobId: job.id, roleId: job.role_id, profileId: job.profile_id});
        try {
          while (!stopped) {
            const rows = await db.prepare('SELECT seq,event_json FROM membership_bridge_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT 100').bind(job.id, cursor).all();
            let terminal = false;
            for (const row of rows.results) {const event = JSON.parse(row.event_json); cursor = row.seq; emit(event); if (['done','error'].includes(event.type)) terminal = true;}
            if (terminal) break;
            const latest = await db.prepare('SELECT status FROM membership_bridge_jobs WHERE id=?').bind(job.id).first();
            if (!latest || latest.status === 'cancelled' || Date.now() - job.created_at >= BRIDGE_TURN_LIMIT) {emit({type: 'error', message: '这次回答已停止或连接超时，请重新提问。', jobId: job.id}); await cancel(); break;}
            await new Promise(resolve => setTimeout(resolve, 700));
          }
        } catch (_) {emit({type: 'error', message: '会员连接暂时中断，请稍后重试。', jobId: job.id}); await cancel().catch(() => {});}
        finally {stopped = true; try {controller.close();} catch (_) { /* Reader may have cancelled. */ }}
      })();
    },
    cancel
  });
  return new Response(stream, {headers: {...SECURITY_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no'}});
}
async function membershipApi(request, env, id, url) {
  sameOrigin(request, request.method === 'POST');
  const db = bridgeDatabase(env);
  if (url.pathname === '/api/codex/session' && request.method === 'GET') return json({token: 'cloud-session'});
  if (url.pathname === '/api/codex/status' && request.method === 'GET') return json(await membershipStatus(db));
  if (request.method !== 'POST') bridgeFault(405, 'method_not_allowed', '请通过网页提交学习问题。');
  const body = await bridgeBody(request);
  bridgeScope(body);
  if (url.pathname === '/api/codex/chat') {
    keys(body, ['roleId','profileId','message','context','conversationId'], ['roleId','profileId','message']);
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 16000 || body.context !== undefined && (typeof body.context !== 'string' || body.context.length > 12000) || body.conversationId !== undefined && !bridgeId(body.conversationId)) bridgeFault(400, 'invalid_question', '问题或学习背景格式无效。');
    if (!(await membershipStatus(db)).authenticated) bridgeFault(503, 'bridge_offline', '会员连接电脑未运行或尚未完成本人登录；请启动连接服务，学习记录和测验仍可使用。');
    const now = Date.now(), jobId = crypto.randomUUID();
    const input = {roleId: body.roleId, profileId: body.profileId, message: body.message.trim(), context: body.context || '', ...(body.conversationId ? {conversationId: body.conversationId} : {})};
    const job = await db.prepare("INSERT INTO membership_bridge_jobs (id,owner_id,role_id,profile_id,status,request_json,created_at,updated_at,expires_at) SELECT ?,?,?,?,'queued',?,?,?,? WHERE (SELECT COUNT(*) FROM membership_bridge_jobs WHERE owner_id=? AND status IN ('queued','running') AND created_at>?) < 4 RETURNING *").bind(jobId, id, body.roleId, body.profileId, JSON.stringify(input), now, now, now + BRIDGE_TTL, id, now - BRIDGE_TURN_LIMIT).first();
    if (!job) bridgeFault(429, 'bridge_busy', '正在处理的学习问题较多，请等当前回答结束后再发。');
    return membershipStream(db, job, request);
  }
  if (url.pathname === '/api/codex/cancel') {
    keys(body, ['roleId','profileId','conversationId','jobId'], ['roleId','profileId']);
    const job = await membershipJob(db, id, body.roleId, body.profileId, body.jobId, body.conversationId);
    await db.prepare("UPDATE membership_bridge_jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running')").bind(Date.now(), job.id).run();
    return json({cancelled: true});
  }
  if (url.pathname === '/api/codex/tool-result') {
    keys(body, ['roleId','profileId','jobId','conversationId','callId','nonce','result'], ['roleId','profileId','jobId','callId','nonce','result']);
    const job = await membershipJob(db, id, body.roleId, body.profileId, body.jobId);
    if (job.status !== 'running') bridgeFault(409, 'job_ended', '当前学习任务已结束，未执行后续操作。');
    if (body.conversationId !== undefined && body.conversationId !== job.conversation_id) bridgeFault(403, 'conversation_mismatch', '学习操作与当前对话不一致。');
    if (typeof body.callId !== 'string' || body.callId.length > 160 || !bridgeNonce(body.nonce) || !object(body.result)) bridgeFault(400, 'invalid_tool_result', '学习操作回执无效。');
    const old = await db.prepare('SELECT nonce,result_json FROM membership_bridge_tools WHERE job_id=? AND call_id=?').bind(job.id, body.callId).first();
    if (!old || old.nonce !== body.nonce) bridgeFault(403, 'tool_forbidden', '学习操作与当前任务不一致。');
    const serialized = JSON.stringify(body.result);
    if (serialized.length > 120000) bridgeFault(413, 'result_too_large', '学习操作结果过长。');
    if (old.result_json && old.result_json !== serialized) bridgeFault(409, 'result_conflict', '这次操作已收到另一份回执。');
    await db.prepare('UPDATE membership_bridge_tools SET result_json=? WHERE job_id=? AND call_id=? AND result_json IS NULL').bind(serialized, job.id, body.callId).run();
    return json({ok: true});
  }
  bridgeFault(404, 'not_found', '没有这个学习接口。');
}
