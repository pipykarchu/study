/* 两个学习角色共用站点所有者账号；角色分开保存内容，不是登录或权限。 */
(function (global) {
  'use strict';
  const roles = Object.freeze({
    apple: Object.freeze({id: 'apple', name: '貔貅', avatar: '🐾', description: '我的学习知识框架'}),
    sheep: Object.freeze({id: 'sheep', name: '小羊', avatar: '🐑', description: '小羊的学习知识框架'})
  });
  const SESSION_KEY = 'study-bloom-active-role-v1';
  const SWITCH_NOTE_KEY = 'study-bloom-role-switch-note-v1';
  const params = new global.URLSearchParams(global.location.search);
  const chosen = params.getAll('role');
  const explicit = chosen.length === 1 && Object.prototype.hasOwnProperty.call(roles, chosen[0]);
  let remembered = null;
  try { remembered = global.sessionStorage.getItem(SESSION_KEY); } catch (_) { /* URL 仍能固定当前角色。 */ }
  const id = explicit ? chosen[0] : chosen.length === 0 && Object.prototype.hasOwnProperty.call(roles, remembered) ? remembered : 'apple';
  const current = roles[id];
  let dialog, busy = false, notice = chosen.length && !explicit ? '网址里的角色无效，请重新选择。' : '';
  const needsChoice = !explicit && !Object.prototype.hasOwnProperty.call(roles, remembered);
  if (explicit) { try { global.sessionStorage.setItem(SESSION_KEY, id); } catch (_) {} }

  function storageKey(base) { return id === 'apple' ? base : base + ':sheep'; }
  function endpoint(base = '/api/study/state') {
    const url = new global.URL(base, global.location.href);
    if (url.origin !== global.location.origin) throw new Error('学习接口必须属于本站。');
    url.searchParams.set('role', id);
    return url.pathname + url.search;
  }
  function urlFor(next) {
    if (!Object.prototype.hasOwnProperty.call(roles, next)) throw new Error('请选择貔貅或小羊。');
    const target = new global.URL(global.location.href);
    target.searchParams.set('role', next);
    return target.href;
  }
  function showNotice(text) {
    notice = text;
    const line = dialog?.querySelector('.role-switch-note');
    if (line) line.textContent = notice;
  }
  function close() {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }
  function localDraftAvailable() {
    if (global.StudyApp?.getStorageStatus?.().available === false || global.StudyLearning?.getStorageStatus?.().available === false) return false;
    const key = storageKey('study-bloom-role-storage-check');
    try { global.localStorage.setItem(key, '1'); global.localStorage.removeItem(key); return true; }
    catch (_) { return false; }
  }
  async function choose(next) {
    if (!Object.prototype.hasOwnProperty.call(roles, next)) throw new Error('请选择貔貅或小羊。');
    if (busy) return false;
    if (next === id && explicit) { close(); return true; }
    busy = true;
    for (const button of dialog?.querySelectorAll('[data-role]') || []) button.disabled = true;
    let saved = false;
    try {
      showNotice('正在保存当前角色的学习记录…');
      try {
        if (global.StudySync) {
          const result = await global.StudySync.flush();
          saved = Boolean(result.cloudSaved);
        }
      } catch (_) { /* 离线或冲突时，当前角色的本地草稿仍独立保留。 */ }
      const status = global.StudySync?.status();
      if (!saved && status?.dirty && !localDraftAvailable()) {
        showNotice('当前记录尚未同步，浏览器也无法保留草稿。请先在资料页导出备份，再切换角色。');
        return false;
      }
      if (!saved && status?.dirty) {
        const text = current.name + '的草稿已单独留在此浏览器，切回来可继续同步。';
        showNotice(text);
        try { global.sessionStorage.setItem(SWITCH_NOTE_KEY, text); } catch (_) {}
      }
      try { global.sessionStorage.setItem(SESSION_KEY, next); } catch (_) {}
      // 整页切换，避免内存中的测验、同步队列或 Codex 工具串到另一角色。
      global.location.assign(urlFor(next));
      return true;
    } finally {
      busy = false;
      for (const button of dialog?.querySelectorAll('[data-role]') || []) button.disabled = false;
    }
  }
  function show() {
    if (!dialog) mount();
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function mount() {
    global.document.body.dataset.studyRole = id;
    const root = global.document.getElementById('study-role-control');
    if (root && !root.querySelector('.study-role-button')) {
      const button = global.document.createElement('button');
      button.type = 'button'; button.className = 'study-role-button';
      const mark = global.document.createElement('span'); mark.className = 'role-current-avatar'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = current.avatar;
      const label = global.document.createElement('span'); label.textContent = current.name + ' · 切换'; button.append(mark, label);
      button.setAttribute('aria-label', '当前角色' + current.name + '，切换学习角色');
      button.addEventListener('click', show); root.appendChild(button);
      try {
        const text = global.sessionStorage.getItem(SWITCH_NOTE_KEY);
        if (text) {
          const line = global.document.createElement('small'); line.className = 'role-switch-banner'; line.setAttribute('role', 'status'); line.textContent = text; root.appendChild(line);
          global.sessionStorage.removeItem(SWITCH_NOTE_KEY);
        }
      } catch (_) {}
    }
    if (dialog) return;
    dialog = global.document.createElement('dialog');
    dialog.id = 'study-role-dialog'; dialog.className = 'study-role-dialog';
    const heading = global.document.createElement('div'); heading.className = 'role-picker-heading';
    const title = global.document.createElement('h2'); title.id = 'study-role-title'; title.textContent = '今天是谁来学习？';
    const intro = global.document.createElement('p'); intro.textContent = '用你的同一个 Codex 账号，为两个人分别保留目标、知识框架和进度。';
    heading.append(title, intro); dialog.appendChild(heading); dialog.setAttribute('aria-labelledby', title.id);
    const list = global.document.createElement('div'); list.className = 'role-picker-list';
    for (const role of Object.values(roles)) {
      const button = global.document.createElement('button'); button.type = 'button'; button.className = 'role-card'; button.dataset.role = role.id;
      button.setAttribute('aria-pressed', String(role.id === id));
      const avatar = global.document.createElement('span'); avatar.className = 'role-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = role.avatar;
      const name = global.document.createElement('strong'); name.textContent = role.name;
      const description = global.document.createElement('small'); description.textContent = role.description;
      button.append(avatar, name, description);
      button.addEventListener('click', () => { choose(role.id).catch(() => showNotice('暂时无法切换，当前记录已保留，请稍后再试。')); });
      list.appendChild(button);
    }
    dialog.appendChild(list);
    const line = global.document.createElement('p'); line.className = 'role-switch-note'; line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite'); line.textContent = notice || '切换角色，继续各自的学习记录。'; dialog.appendChild(line);
    const dismiss = global.document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'text-button'; dismiss.textContent = '继续使用' + current.name; dismiss.addEventListener('click', close); dialog.appendChild(dismiss);
    global.document.body.appendChild(dialog);
  }
  global.StudyRole = Object.freeze({...current, storageKey, endpoint, urlFor, choose, show, mount});
  const ready = () => { mount(); if (needsChoice || chosen.length && !explicit) show(); };
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', ready, {once: true});
  else ready();
})(window);
