/* 直接写目标，交给旁边的 GPT 生成；不在网页中索取账号或密钥。 */
(() => {
  'use strict';
  const drafts = new Map();
  let lifecycle = 0, hidden = false;
  const levels = ['认识概念', '解释原理', '能独立应用', '能够排错', '能够迁移创造'];
  const fields = ['goal', 'why', 'outcome', 'level', 'minutes'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keyOf = data => `${data.roleId === 'sheep' ? 'sheep' : 'apple'}:${data.profileId || 'product'}`;
  const context = () => window.StudyApp && window.StudyApp.getContext ? window.StudyApp.getContext() : null;
  const currentTarget = (key, epoch=lifecycle) => {const data=context();return !hidden&&epoch===lifecycle&&!window.StudyRole?.isSwitching?.()&&data&&keyOf(data)===key;};
  const findPanel = key => Array.from(document.querySelectorAll('[data-study-planner]')).find(el => el.dataset.plannerKey === key);
  function entry(data) {
    const key = keyOf(data);
    if (!drafts.has(key)) drafts.set(key, {dirty:false, values:{}, prompt:'', status:'', error:false, manual:false, busy:false, revision:0});
    return drafts.get(key);
  }
  function valuesFrom(data) {
    return {goal:data.goal || '', why:data.why || '', outcome:data.outcome || '', level:levels.includes(data.level) ? data.level : '能独立应用', minutes:Number(data.minutes) || 45};
  }
  function buildPrompt(data) {
    const roleId = data.roleId === 'sheep' ? 'sheep' : 'apple';
    const roleName = data.roleName || (roleId === 'sheep' ? '小羊' : '貔貅');
    return [
      '请帮我在知芽学习网站里搭建知识框架。',
      '先调用 study_get_context 读取本站当前角色、学习方向和已保存目标。',
      `本次只为角色 ${roleName}（roleId=${roleId}）、方向 ${data.profile || data.profileId}（profileId=${data.profileId}）生成。`,
      '如果当前 roleId 或 profileId 与上面不一致，请让我切换后再继续，不要写入其他角色或方向。',
      '调用任何写入工具都必须带上本次 roleId、profileId；若要切换方向，先重新读取当前上下文，并按工具要求携带 expectedProfileId。',
      '',
      '以下是我刚保存的目标资料：',
      `想做到：${data.goal}`,
      `学习动机：${data.why}`,
      `验收作品：${data.outcome}`,
      `目标水平：${data.level || '能独立应用'}`,
      `每次学习：${data.minutes} 分钟`,
      '',
      '先用大白话概括目标和知识边界，再生成恰好 6 个由浅入深的知识节点。',
      '每个节点都要有名称、简短解释、我亲手做的练习、可检查的验收标准。',
      '另列三份边界：必须掌握、按需了解、这次先不学；每份最多 15 条，每条不超过 300 字。',
      '按先搭框架、抓核心、主动回忆、项目实践、费曼复述和间隔复习来安排，给出第一步练习，不保证固定倍数的学习效果。',
      '然后调用 study_apply_framework，把 roleId、profileId、summary、6 个 nodes（title、description、exercise、acceptance），以及 boundaries（must、optional、later）写回本站。',
      '只保存生成的框架，不把生成文本算作我已学会，不替我做测验，不增加完成进度。',
      '如果本站工具没有连接，请直接展示框架并说明尚未写回，不要声称已更新网页。'
    ].join('\n');
  }
  function preparedMarkup(item) {
    if (!item.prompt) return '';
    return `<details class="planner-prepared" ${item.manual ? 'open' : ''}><summary>${item.manual ? '手动复制生成指令' : '查看这次的生成指令'}</summary><p>把下面整段发给旁边的 GPT / Codex。收到工具写回结果后，知识框架才会更新。</p><textarea class="planner-prompt" readonly aria-label="给 GPT 的框架生成指令" rows="8">${esc(item.prompt)}</textarea><button type="button" class="button secondary small" data-planner-copy>再次复制指令</button></details>`;
  }
  function refresh(key) {
    const root = findPanel(key), item = drafts.get(key);
    if (!root || !item) return;
    const status = root.querySelector('[data-planner-status]');
    status.textContent = item.status;
    status.classList.toggle('planner-error', item.error);
    root.querySelector('[data-planner-prepared]').innerHTML = preparedMarkup(item);
    root.querySelectorAll('[data-planner-submit]').forEach(button => { button.disabled = item.busy; });
    root.setAttribute('aria-busy', String(item.busy));
  }
  function showManual(key) {
    const root = findPanel(key), area = root && root.querySelector('.planner-prompt');
    if (area) { area.focus(); area.select(); }
  }
  async function copyPrepared(key) {
    const item = drafts.get(key);
    if (!item || !item.prompt || !currentTarget(key)) return;
    const epoch=lifecycle, prompt=item.prompt, revision=item.revision;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      if(!currentTarget(key,epoch)||item.revision!==revision)return;
      item.manual = false;
      item.status = '目标已保存，指令已复制。请粘贴到旁边的 GPT / Codex，生成后由站点工具写回。';
      item.error = false;
    } catch (_) {
      if(!currentTarget(key,epoch)||item.revision!==revision)return;
      item.manual = true;
      item.status = '目标已保存。浏览器未允许自动复制，请手动复制下方指令，发给旁边的 GPT / Codex。';
      item.error = false;
    }
    refresh(key);
    if (item.manual) showManual(key);
  }
  function render(input) {
    const data = input || context() || {}, key = keyOf(data), item = entry(data);
    const value = item.dirty ? item.values : valuesFrom(data);
    const sheep = data.roleId === 'sheep';
    const name = data.roleName || (sheep ? '小羊' : '貔貅');
    const avatar = data.roleAvatar || (sheep ? '🐑' : '🐾');
    return `<section class="panel study-planner" data-study-planner data-planner-key="${esc(key)}" aria-busy="${item.busy}" aria-labelledby="planner-title"><div class="planner-heading"><div><div class="section-kicker">GROW YOUR OWN LEARNING MAP</div><h2 id="planner-title">写下目标，让知识框架长出来</h2><p class="planner-intro">输入目标 → 复制给旁边 GPT → GPT 生成并回填</p></div><span class="planner-owner"><span aria-hidden="true">${esc(avatar)}</span><span>${esc(name)}<small>${esc(data.profile || '当前学习方向')}</small></span></span></div><form data-planner-form><div class="planner-fields"><label class="field planner-wide">这次想做到什么？<input name="goal" required maxlength="3000" value="${esc(value.goal)}" placeholder="例如：独立做出一个能用的小网站"></label><label class="field">为什么想学？<textarea name="why" required maxlength="3000" rows="3" placeholder="会用在哪个真实场景？">${esc(value.why)}</textarea></label><label class="field">用什么证明学会了？<textarea name="outcome" required maxlength="3000" rows="3" placeholder="写下可以演示、检查的作品或结果">${esc(value.outcome)}</textarea></label><label class="field">希望学到哪一步？<select name="level">${levels.map(level => `<option ${value.level === level ? 'selected' : ''}>${esc(level)}</option>`).join('')}</select></label><label class="field">每次学习几分钟？<input name="minutes" type="number" min="15" max="180" step="1" required value="${esc(value.minutes)}"></label></div><div class="planner-actions"><button class="button secondary" type="submit" value="save" data-planner-submit ${item.busy ? 'disabled' : ''}>保存目标</button><button class="button primary" type="submit" value="prepare" data-planner-submit ${item.busy ? 'disabled' : ''}>保存并准备 GPT 生成 <span aria-hidden="true">↗</span></button></div></form><p class="planner-status ${item.error ? 'planner-error' : ''}" data-planner-status role="status" aria-live="polite">${esc(item.status)}</p><div data-planner-prepared>${preparedMarkup(item)}</div><details class="planner-help"><summary>怎样让 GPT 帮我回填？</summary><ol><li>先在这里填写并保存目标，复制生成指令。</li><li>在 Codex 里打开本站，把指令发到旁边的对话。</li><li>GPT 读取当前角色，生成框架后通过本站工具写回。</li></ol><p>网页里的按钮负责保存和准备指令，生成发生在你的对话里。无需在网页输入密码或密钥；工具未连接时，可以先保留 GPT 的回答。</p></details></section>`;
  }
  document.addEventListener('input', event => {
    const field = event.target, form = field.closest && field.closest('[data-planner-form]');
    if (!form || !fields.includes(field.name)) return;
    const root = form.closest('[data-study-planner]'), key = root.dataset.plannerKey, item = drafts.get(key);
    if (!item) return;
    item.values = Object.fromEntries(fields.map(name => [name, form.elements[name].value]));
    item.revision++;
    item.dirty = true;
    item.prompt = '';
    item.status = '目标有修改，保存后再交给 GPT。';
    item.manual = false;
    item.error = false;
    refresh(key);
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches || !form.matches('[data-planner-form]')) return;
    event.preventDefault();
    const root = form.closest('[data-study-planner]'), key = root.dataset.plannerKey, item = drafts.get(key);
    if (!item || item.busy) return;
    const data = context();
    if (!data || !currentTarget(key) || !window.StudyApp.updateGoal) {
      item.status = '当前角色或方向已变化，请重新打开目标面板后再保存。';
      item.error = true;
      refresh(key);
      return;
    }
    const values = Object.fromEntries(fields.map(name => [name, form.elements[name].value.trim()]));
    values.minutes = Number(values.minutes);
    item.values = values;
    item.dirty = true;
    item.busy = true;
    item.prompt = '';
    item.status = '正在保存目标…';
    item.error = false;
    const epoch=lifecycle, revision=item.revision;
    refresh(key);
    try {
      if (['goal','why','outcome'].some(name => !values[name] || values[name].length > 3000)) throw Error('请先填写目标、学习动机和验收作品，每项最多 3000 字。');
      if (!levels.includes(values.level)) throw Error('请选择有效的目标水平。');
      if (!Number.isInteger(values.minutes) || values.minutes < 15 || values.minutes > 180) throw Error('每次学习时间请填写 15 至 180 分钟的整数。');
      if(!currentTarget(key,epoch))throw Error('当前角色或方向已变化，请切回原目标面板再保存。');
      const saved = await window.StudyApp.updateGoal(values);
      if (saved === false) throw Error('目标还没有保存成功，请重试。');
      const latest = context();
      if (!latest || !currentTarget(key,epoch)) throw Error('目标已保留在原角色和方向，请切回原目标面板查看。');
      if(item.revision!==revision)throw Error('原目标已保存，新修改仍保留在输入框，请保存后再生成。');
      item.dirty = false;
      if (event.submitter && event.submitter.value === 'prepare') {
        item.prompt = buildPrompt({...latest, ...values});
        await copyPrepared(key);
      } else item.status = '目标已保存。准备好后，可以交给旁边的 GPT 生成框架。';
    } catch (error) {
      item.status = error && error.message ? String(error.message).slice(0,400) : '目标未保存成功，请保留内容后重试。';
      item.error = true;
    } finally {
      item.busy = false;
      refresh(key);
      if (item.manual) showManual(key);
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('[data-planner-copy]');
    if (button) copyPrepared(button.closest('[data-study-planner]').dataset.plannerKey);
  });
  window.addEventListener('study-role-leaving',()=>{lifecycle++;});
  window.addEventListener('pagehide',()=>{lifecycle++;hidden=true;});
  window.addEventListener('pageshow',event=>{if(event.persisted)hidden=false;});
  window.StudyPlanner = Object.freeze({render});
})();
