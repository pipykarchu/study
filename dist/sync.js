/* 学习记录通过本站的同源接口同步；登录凭据由站点管理，不进入网页存储。 */
(function (global) {
  'use strict';
  const META_KEY = 'study-bloom-cloud-sync-v1';
  const APP_KEY = 'study-bloom-v1';
  const LEARNING_KEY = 'study-bloom-learning-v2';
  const ENDPOINT = '/api/study/state';
  const SITE = 'https://study-bloom.yellow-spool-5033.chatgpt.site/#coach';
  const host = global.location.hostname.toLowerCase();
  const localOnly = host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]' || host === '::1' || !/^https?:$/.test(global.location.protocol);
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const validRevision = value => Number.isSafeInteger(value) && value >= 0;
  let meta = {version: 1, revision: null, dirty: false, baseline: null, backup: null};
  let state = localOnly ? 'ready' : 'loading', verified = false, updatedAt = null;
  let error = '', conflict = null, generation = 0, suppress = 0, storageWarning = false;
  let debounce, peerTimer, lastCheck = 0, operation = Promise.resolve();

  function snapshot() {
    if (!global.StudyApp || !global.StudyLearning) throw new Error('学习页面尚未准备好，请刷新后重试。');
    return {app: global.StudyApp.exportData(), learning: global.StudyLearning.exportData()};
  }
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'app,learning') throw new Error('云端学习记录格式有误，本机记录已保留。');
    // 两部分先完整校验，再应用，避免只导入一半。
    return {app: global.StudyApp.validateData(raw.app), learning: global.StudyLearning.validateData(raw.learning)};
  }
  function meaningful(data) {
    const a = data.app;
    if (a.profile !== 'product' || a.minutes !== 45 || a.day !== 0) return true;
    if (a.timer && (a.timer.remaining !== 1500 || a.timer.deadline)) return true;
    if (['goals', 'completed', 'tasks', 'notes', 'reviews', 'projectTasks', 'boundaries'].some(key => a[key] && Object.keys(a[key]).length > 0)) return true;
    return Object.values(data.learning.profiles || {}).some(p => p.stage !== 'frame' || p.completedStages.length || p.recentEvidence.length || p.quiz.active || p.quiz.attempts.length);
  }
  function readMeta() {
    try {
      const raw = JSON.parse(global.localStorage.getItem(META_KEY) || 'null');
      if (!raw || raw.version !== 1 || !(raw.revision === null || validRevision(raw.revision)) || typeof raw.dirty !== 'boolean') return;
      const baseline = raw.baseline === null ? null : validate(raw.baseline);
      if (raw.revision !== null && !baseline) return;
      let backup = null;
      if (raw.backup && Number.isFinite(raw.backup.savedAt) && typeof raw.backup.reason === 'string') backup = {state: validate(raw.backup.state), savedAt: raw.backup.savedAt, reason: raw.backup.reason.slice(0, 100)};
      meta = {version: 1, revision: raw.revision, dirty: raw.dirty, baseline, backup};
    } catch (_) { storageWarning = true; }
  }
  function persist() {
    try { global.localStorage.setItem(META_KEY, JSON.stringify(meta)); }
    catch (_) { storageWarning = true; }
  }
  function status() {
    return {mode: localOnly ? 'local' : 'cloud', state, verified, revision: meta.revision, dirty: meta.dirty, cloudSaved: !localOnly && verified && state === 'ready' && !meta.dirty && !conflict, updatedAt, error, conflict: Boolean(conflict), backupAvailable: Boolean(meta.backup), storageWarning};
  }
  function notify() {
    mount();
    global.dispatchEvent(new global.CustomEvent('study-sync-change', {detail: status()}));
  }
  function backup(reason) {
    meta.backup = {state: snapshot(), savedAt: Date.now(), reason};
    persist();
  }
  function apply(data) {
    const clean = validate(data);
    suppress++;
    try { global.StudyLearning.importData(clean.learning); global.StudyApp.importData(clean.app); }
    finally { suppress--; }
    return snapshot();
  }
  function adopt(remote, data) {
    const current = data || apply(remote.state);
    meta.revision = remote.revision;
    meta.baseline = clone(current);
    meta.dirty = false;
    updatedAt = remote.updatedAt;
    conflict = null; error = ''; state = 'ready'; persist(); notify();
  }
  function retainConflict(remote, reason) {
    backup(reason || '云端与本机都有未合并的记录');
    conflict = {revision: remote.revision, state: remote.state, updatedAt: remote.updatedAt};
    meta.dirty = true; state = 'conflict'; error = '云端和本机都有更新，请选择要继续使用的记录。本机副本已保留。';
    persist(); notify();
  }
  function enqueue(fn) {
    const next = operation.catch(() => undefined).then(fn);
    operation = next.catch(() => undefined);
    return next;
  }
  function fault(message, kind) { const e = new Error(message); e.kind = kind; return e; }
  async function request(method, payload) {
    const controller = new global.AbortController();
    const timeout = global.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await global.fetch(ENDPOINT, {method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: payload ? {'Accept': 'application/json', 'Content-Type': 'application/json'} : {'Accept': 'application/json'}, ...(payload ? {body: JSON.stringify(payload)} : {})});
      if (response.status === 401 || response.status === 403) throw fault('请用站点所有者的账号登录；学习草稿仍保存在此浏览器。', 'unauthorized');
      if (!response.ok && response.status !== 409) throw fault('暂时连不上云端，学习草稿已留在此浏览器。请稍后重试。', 'offline');
      let raw;
      try { raw = await response.json(); } catch (_) { throw fault('云端没有返回有效的学习记录，本机草稿已保留。', 'offline'); }
      if (!raw || !raw.identity || raw.identity.verified !== true || raw.identity.owner !== true) throw fault('未能确认站点所有者身份，本机草稿已保留。', 'unauthorized');
      if (!validRevision(raw.revision) || !(raw.state === null || (raw.state && typeof raw.state === 'object'))) throw fault('云端记录版本无效，本机草稿已保留。', 'offline');
      let clean;
      try { clean = raw.state === null ? null : validate(raw.state); } catch (e) { throw fault(e.message, 'offline'); }
      verified = true;
      if (method === 'GET') lastCheck = Date.now();
      return {revision: raw.revision, state: clean, updatedAt: typeof raw.updatedAt === 'string' || Number.isFinite(raw.updatedAt) ? raw.updatedAt : null, collision: response.status === 409};
    } catch (e) {
      if (e.kind) throw e;
      throw fault('网络未连接，学习草稿已留在此浏览器。恢复网络后可继续同步。', 'offline');
    } finally { global.clearTimeout(timeout); }
  }
  function failed(e) {
    state = e.kind === 'unauthorized' ? 'unauthorized' : 'offline';
    if (state === 'unauthorized') verified = false;
    error = e.message || '暂时无法同步，本机草稿已保留。'; persist(); notify();
  }
  function reconcile(remote) {
    const current = snapshot();
    updatedAt = remote.updatedAt;
    if (remote.state === null) {
      meta.revision = remote.revision;
      meta.baseline = meaningful(current) ? null : clone(current);
      meta.dirty = meaningful(current);
      conflict = null; error = ''; state = 'ready'; persist(); notify(); return;
    }
    if (same(current, remote.state)) { adopt(remote, current); return; }
    const associated = meta.revision !== null && meta.baseline !== null;
    const dirty = meta.dirty || (associated && !same(current, meta.baseline));
    if ((!associated && meaningful(current)) || (associated && dirty && remote.revision !== meta.revision)) {
      retainConflict(remote); return;
    }
    if (associated && dirty) {
      meta.dirty = true; conflict = null; error = ''; state = 'ready'; persist(); notify(); return;
    }
    adopt(remote);
  }
  async function pull() {
    if (localOnly) return status();
    state = 'syncing'; error = ''; notify();
    try { const remote = await request('GET'); reconcile(remote); return status(); }
    catch (e) { failed(e); throw e; }
  }
  async function push() {
    if (!verified || state === 'unauthorized') throw fault('请先用站点所有者账号登录。', 'unauthorized');
    if (conflict) throw fault('请先选择使用云端还是保留本机记录。', 'conflict');
    if (!meta.dirty) return status();
    const submitted = snapshot(), sentGeneration = generation;
    state = 'syncing'; error = ''; notify();
    let remote;
    try { remote = await request('PUT', {baseRevision: meta.revision, snapshot: submitted}); }
    catch (e) { failed(e); throw e; }
    if (remote.collision) {
      if (remote.state && same(snapshot(), remote.state)) { adopt(remote, snapshot()); return status(); }
      retainConflict(remote); throw fault(error, 'conflict');
    }
    if (!remote.state || !same(remote.state, submitted)) {
      const e = fault('云端保存结果与提交内容不一致，本机草稿已保留。', 'offline'); failed(e); throw e;
    }
    meta.revision = remote.revision; meta.baseline = clone(submitted); updatedAt = remote.updatedAt;
    meta.dirty = sentGeneration !== generation || !same(snapshot(), submitted);
    state = 'ready'; error = ''; persist(); notify();
    return status();
  }
  function schedule() {
    global.clearTimeout(debounce);
    if (localOnly || conflict || state === 'unauthorized' || state === 'offline') return;
    debounce = global.setTimeout(() => { flush().catch(() => undefined); }, 700);
  }
  function changed() {
    if (suppress) return;
    generation++;
    try { meta.dirty = !meta.baseline || !same(snapshot(), meta.baseline); }
    catch (e) { error = e.message; }
    persist(); notify(); schedule();
  }
  async function ensureWritable() {
    await ready;
    if (localOnly) throw fault('此处只保存本机记录，请在 Codex 中打开私人云端网站后使用同步学习工具。', 'local');
    if (!verified || state === 'unauthorized') throw fault('请先用站点所有者账号登录私人网站。', 'unauthorized');
    if (conflict) throw fault('云端和本机都有更新，请先在网页选择保留哪一份记录。', 'conflict');
    if (state === 'offline') throw fault('当前离线，草稿尚未同步，请恢复网络后重试。', 'offline');
    return status();
  }
  async function flush() {
    await ready;
    global.clearTimeout(debounce);
    if (localOnly) return {...status(), localOnly: true};
    return enqueue(async () => {
      await ensureWritable();
      for (let i = 0; meta.dirty && i < 10; i++) await push();
      if (meta.dirty) throw fault('学习记录仍在变化，最新草稿已保留，请稍后再次同步。', 'busy');
      return status();
    });
  }
  async function retry() {
    await ready;
    if (localOnly) return status();
    global.clearTimeout(debounce);
    return enqueue(async () => { await pull(); if (conflict) throw fault(error, 'conflict'); for (let i = 0; meta.dirty && i < 10; i++) await push(); return status(); });
  }
  async function resolveConflict(choice) {
    await ready;
    if (!['cloud', 'local'].includes(choice) || !conflict) throw fault('请先查看同步冲突，再选择要使用的记录。', 'conflict');
    global.clearTimeout(debounce);
    return enqueue(async () => {
      const before = generation;
      let remote;
      try { remote = await request('GET'); } catch (e) { failed(e); throw e; }
      if (before !== generation) { retainConflict(remote, '选择期间又有本机修改'); throw fault('选择期间又有新的学习记录，请重新确认。', 'conflict'); }
      backup(choice === 'cloud' ? '选择云端前的本机副本' : '明确选择保留本机并上传');
      if (choice === 'cloud') {
        if (!remote.state) { retainConflict(remote); throw fault('云端暂时没有可恢复的记录，请保留本机记录。', 'conflict'); }
        adopt(remote); return status();
      }
      // 用户明确选择后，使用刚读取的最新版本提交；再次冲突时仍需重新选择。
      meta.revision = remote.revision; meta.baseline = remote.state ? clone(remote.state) : null;
      meta.dirty = !remote.state || !same(snapshot(), remote.state); conflict = null; state = 'ready'; error = ''; persist(); notify();
      if (meta.dirty) await push();
      if (meta.dirty) schedule();
      return status();
    });
  }
  function downloadBackup() {
    if (!meta.backup) return;
    const data = {...meta.backup.state.app, learning: meta.backup.state.learning};
    const url = global.URL.createObjectURL(new global.Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const link = global.document.createElement('a'); link.href = url; link.download = '知芽-同步冲突保留副本.json'; link.click(); global.URL.revokeObjectURL(url);
  }
  function mount() {
    const root = global.document.getElementById('study-sync-status');
    if (!root) return;
    root.replaceChildren(); root.className = 'study-sync-status'; root.dataset.syncState = state;
    const line = global.document.createElement('p'); line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite');
    line.textContent = localOnly ? '本机记录；云端请打开网站' : ({loading: '正在确认账号与学习记录…', syncing: '正在同步学习记录…', conflict: '两份记录都有更新，请选择', unauthorized: '请用站点所有者账号登录', offline: '离线草稿 · 恢复网络后重试', ready: meta.dirty ? '本机草稿待同步' : '学习记录已同步'})[state]; root.appendChild(line);
    if (localOnly) { const link = global.document.createElement('a'); link.href = SITE; link.textContent = '打开私人云端网站'; root.appendChild(link); return; }
    if (error) { const detail = global.document.createElement('small'); detail.textContent = error; root.appendChild(detail); }
    if (storageWarning) { const detail = global.document.createElement('small'); detail.textContent = '浏览器无法保留离线副本，请保持页面打开，并在离开前确认云端已同步或导出备份。'; root.appendChild(detail); }
    const button = (label, action) => { const el = global.document.createElement('button'); el.type = 'button'; el.textContent = label; el.addEventListener('click', () => { el.disabled = true; Promise.resolve().then(action).catch(e => { if (e.kind !== 'conflict') { error = e.message; notify(); } }).finally(() => { el.disabled = false; }); }); root.appendChild(el); };
    if (conflict) { button('使用云端', () => resolveConflict('cloud')); button('保留本机并上传', () => resolveConflict('local')); }
    else if (state === 'offline' || state === 'unauthorized') button('重试同步', retry);
    if (meta.backup) button('下载保留副本', downloadBackup);
  }
  function peerChanged(event) {
    if (![APP_KEY, LEARNING_KEY, META_KEY].includes(event.key)) return;
    global.clearTimeout(peerTimer);
    peerTimer = global.setTimeout(() => {
      try {
        const app = JSON.parse(global.localStorage.getItem(APP_KEY) || 'null');
        const learning = JSON.parse(global.localStorage.getItem(LEARNING_KEY) || 'null');
        if (!app || !learning) return;
        const other = validate({app, learning});
        if (same(snapshot(), other)) return;
        if (meta.dirty || state === 'syncing' || conflict) {
          backup('另一页修改前保留的本页草稿');
          // 不让另一页的旧响应覆盖本页的新草稿；下一次同步按服务端版本处理。
          error = '另一页也有学习记录更新，本页草稿已保留。请先重试同步。'; state = 'offline'; notify(); return;
        }
        apply(other); changed();
      } catch (_) { error = '另一页的学习记录格式有误，本页记录已保留。'; notify(); }
    }, 30);
  }
  readMeta();
  try { const current = snapshot(); meta.dirty = meta.dirty || (meta.baseline ? !same(current, meta.baseline) : meaningful(current)); }
  catch (e) { error = e.message; state = 'offline'; }
  global.addEventListener('study-app-change', changed);
  global.addEventListener('study-learning-change', changed);
  global.addEventListener('storage', peerChanged);
  global.addEventListener('online', () => { if (!localOnly && state === 'offline') retry().catch(() => undefined); });
  const checkOnReturn = () => {
    if (!localOnly && global.document.visibilityState !== 'hidden' && Date.now() - lastCheck >= 15000 && !conflict && !['loading', 'syncing', 'unauthorized'].includes(state)) retry().catch(() => undefined);
  };
  global.addEventListener('focus', checkOnReturn);
  global.document.addEventListener('visibilitychange', checkOnReturn);
  const ready = enqueue(async () => {
    if (localOnly) { persist(); notify(); return status(); }
    try { await pull(); if (meta.dirty && !conflict) schedule(); } catch (_) { /* 离线状态可继续保留普通页面草稿。 */ }
    return status();
  });
  global.StudySync = Object.freeze({ready, status, mount, flush, retry, ensureWritable, resolveConflict, exportBackup: () => meta.backup ? clone(meta.backup) : null});
  notify();
})(window);
