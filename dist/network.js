/* Wiki relationships are explicit curriculum links, saved references, and saved materials. */
(function (global) {
  'use strict';
  const WIDTH = 1000, HEIGHT = 650, MIN_RADIUS = 14, MAX_RADIUS = 42;
  const caches = new Map();
  let active = null, pending = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const scopeKey = data => `${data.roleId}:${data.profileId}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const number = value => Number.isFinite(value) ? value : 0;
  const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
  const short = (value, max) => { const chars = Array.from(text(value)); return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); };
  function cacheFor(data) {
    const key = scopeKey(data);
    if (!caches.has(key)) caches.set(key, {positions: new Map(), view: {scale: 1, x: 0, y: 0}});
    return caches.get(key);
  }
  function radius(score) {return Math.sqrt(MIN_RADIUS * MIN_RADIUS + (MAX_RADIUS * MAX_RADIUS - MIN_RADIUS * MIN_RADIUS) * score / 100);}
  function mastery(data) {
    try {
      const since = Number.isSafeInteger(data.masterySince) && data.masterySince >= 0 ? data.masterySince : 0;
      return global.StudyLearning?.getNodeMastery?.(data.profileId, {since}) || [];
    } catch (_) {return [];}
  }
  function materialList(data) {
    const app = global.StudyApp;
    const current = app?.getContext?.();
    if (!current || scopeKey(current) !== scopeKey(data)) return [];
    try {return (app.listMaterials?.() || []).filter(item => item && item.profileId === data.profileId && (!item.roleId || item.roleId === data.roleId)).slice(0, 24);} catch (_) {return [];}
  }
  function bound(node) {
    const marginX = node.kind === 'knowledge' ? 90 : 35;
    node.x = clamp(number(node.x), marginX + node.r, WIDTH - marginX - node.r);
    node.y = clamp(number(node.y), 40 + node.r, HEIGHT - (node.kind === 'knowledge' ? 82 : 48) - node.r);
  }
  function arrange(nodes, edges, saved) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const fresh = nodes.filter(n => !saved.has(n.id));
    if (!fresh.length) return;
    for (let tick = 0; tick < 150; tick++) {
      for (const n of nodes) {n.fx = (WIDTH / 2 - n.x) * .0015; n.fy = (HEIGHT / 2 - n.y) * .0015;}
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) + Math.abs(dy) < .1) {dx = (i + 1) * .7; dy = (j + 1) * .4;}
        const distance = Math.max(1, Math.hypot(dx, dy));
        const clearance = a.r + b.r + (a.kind === 'knowledge' && b.kind === 'knowledge' ? 105 : a.kind === 'material' && b.kind === 'material' ? 18 : 48);
        const force = Math.min(7, 1250 / (distance * distance) + Math.max(0, clearance - distance) * .065);
        const fx = dx / distance * force, fy = dy / distance * force;
        a.fx -= fx; a.fy -= fy; b.fx += fx; b.fy += fy;
      }
      for (const edge of edges) {
        const a = byId.get(edge.from), b = byId.get(edge.to), dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const wanted = edge.kind === 'material' ? 96 : edge.kind === 'goal' ? 222 : 244;
        const force = (distance - wanted) * (edge.kind === 'material' ? .008 : .003);
        a.fx += dx / distance * force; a.fy += dy / distance * force;
        b.fx -= dx / distance * force; b.fy -= dy / distance * force;
      }
      for (const n of fresh) {n.x += clamp(n.fx, -6, 6); n.y += clamp(n.fy, -6, 6); bound(n);}
    }
  }
  function build(data, selectedIndex) {
    const saved = cacheFor(data), scores = new Map(mastery(data).map(row => [row.nodeIndex, row]));
    const items = (Array.isArray(data.nodes) ? data.nodes : []).filter(n => Number.isInteger(n.index) && n.index >= 0 && n.index < 6).slice(0, 6);
    const starts = [[335,130], [650,125], [790,315], [635,485], [285,475], [170,290]];
    const nodes = [], edges = [], byId = new Map(), edgeKeys = new Set();
    const addNode = n => {
      if (byId.has(n.id)) return;
      const p = saved.positions.get(n.id); if (p) {n.x = p.x; n.y = p.y;}
      bound(n); nodes.push(n); byId.set(n.id, n);
    };
    const addEdge = (from, to, kind, label) => {
      if (from === to || !byId.has(from) || !byId.has(to)) return;
      const key = [from, to].sort().join('|');
      if (edgeKeys.has(key)) {
        const old = edges.find(e => e.key === key);
        if (kind === 'reference' && old?.kind === 'curriculum') {old.kind = kind; old.label = label;}
        return;
      }
      edgeKeys.add(key); edges.push({key, from, to, kind, label});
    };
    if (items.length) addNode({id:'goal', kind:'goal', name:data.goal || '本次学习目标', r:10, x:495, y:300});
    for (const [i, item] of items.entries()) {
      const row = scores.get(item.index) || {}, score = clamp(number(row.score), 0, 100);
      addNode({id:'knowledge:' + item.index, kind:'knowledge', index:item.index, name:item.name || '未命名知识点', score, answered:Math.max(0, number(row.answered)), total:Math.max(0, number(row.total)), correct:Math.max(0, number(row.correct)), r:radius(score), x:starts[i][0], y:starts[i][1]});
      addEdge('goal', 'knowledge:' + item.index, 'goal', '属于当前学习目标');
    }
    for (const link of Array.isArray(data.wikiLinks) ? data.wikiLinks.slice(0, 40) : []) {
      if (!Number.isInteger(link.from) || !Number.isInteger(link.to)) continue;
      const kind = link.source === 'curriculum' ? 'curriculum' : 'reference';
      addEdge('knowledge:' + link.from, 'knowledge:' + link.to, kind, kind === 'curriculum' ? '起步课程建议关联：' + text(link.label || '相关知识') : '已建立的 Wiki 关联');
    }
    const names = new Map();
    for (const n of items) {const name = text(n.name).trim(); names.set(name, names.has(name) ? null : n.index);}
    for (const n of items) {
      const expression = /\[\[([^\[\]\r\n]{1,120})\]\]/g; let found, count = 0;
      while ((found = expression.exec(String(n.note || ''))) && count++ < 80) {
        const target = names.get(found[1].trim());
        if (Number.isInteger(target)) addEdge('knowledge:' + n.index, 'knowledge:' + target, 'reference', '笔记中的 Wiki 引用');
      }
    }
    for (const [i, item] of materialList(data).entries()) {
      if (typeof item.id !== 'string') continue;
      const parent = byId.get('knowledge:' + item.nodeIndex) || byId.get('goal'); if (!parent) continue;
      const angle = i * 2.399963 + .45;
      const id = 'material:' + item.id;
      addNode({id, kind:'material', name:item.title || '学习资料', r:5, x:parent.x + Math.cos(angle) * (86 + i % 3 * 14), y:parent.y + Math.sin(angle) * (86 + i % 3 * 14)});
      addEdge(parent.id, id, 'material', '保存到此知识点的资料');
    }
    arrange(nodes, edges, saved.positions);
    for (const n of nodes) saved.positions.set(n.id, {x:n.x, y:n.y});
    return {data, key:scopeKey(data), nodes, edges, byId, saved, selectedIndex};
  }
  function labelMarkup(n) {
    const chars = Array.from(text(n.name)), first = chars.slice(0, 11).join(''), second = chars.length > 11 ? short(chars.slice(11).join(''), 11) : '';
    const y = n.r + 28;
    return `<text class="network-node-label" y="${y}" aria-hidden="true"><tspan x="0">${escape(first)}</tspan>${second ? `<tspan x="0" dy="25">${escape(second)}</tspan>` : ''}</text>`;
  }
  function nodeMarkup(n, selectedIndex) {
    const position = `translate(${n.x.toFixed(2)} ${n.y.toFixed(2)})`;
    if (n.kind === 'knowledge') {
      const label = `${n.name}，方向参考测验掌握度 ${n.score}%，已答 ${n.answered} / ${n.total} 题`;
      return `<g class="network-node network-knowledge ${n.index === selectedIndex ? 'is-selected' : ''} ${n.score >= 80 ? 'is-strong' : n.score > 0 ? 'is-growing' : 'is-new'}" data-network-id="${escape(n.id)}" data-node="${n.index}" data-node-index="${n.index}" data-network-kind="knowledge" transform="${position}" role="button" tabindex="0" aria-label="${escape(label)}" aria-pressed="${n.index === selectedIndex}" aria-controls="wiki-panel"><title>${escape(label)}</title><circle class="network-focus-ring" r="${n.r + 7}"/><circle class="network-knowledge-circle" r="${n.r.toFixed(3)}" data-score="${n.score}"/>${n.score > 0 ? `<text class="network-node-score" y="6" aria-hidden="true">${n.score}%</text>` : ''}${labelMarkup(n)}</g>`;
    }
    if (n.kind === 'goal') return `<g class="network-node network-goal" data-network-id="goal" data-network-kind="goal" transform="${position}"><title>${escape(n.name)}</title><circle r="${n.r}"/><text y="-24" class="network-goal-label">学习目标</text></g>`;
    return `<g class="network-node network-material" data-network-id="${escape(n.id)}" data-network-kind="material" transform="${position}"><title>${escape(n.name)} · 已保存的资料</title><circle r="${n.r}"/></g>`;
  }
  function edgeMarkup(e, model) {
    const a = model.byId.get(e.from), b = model.byId.get(e.to);
    const selected = 'knowledge:' + model.selectedIndex, related = e.from === selected || e.to === selected;
    return `<line class="network-edge network-edge-${e.kind} ${related ? 'is-related' : ''}" data-network-from="${escape(e.from)}" data-network-to="${escape(e.to)}" x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}"><title>${escape(e.label)}</title></line>`;
  }
  function markup(model) {
    const {data, nodes, edges} = model, knowledge = nodes.filter(n => n.kind === 'knowledge');
    return `<section class="study-network" data-study-network data-network-scope="${escape(model.key)}" aria-label="${escape(data.roleName || '')}的 Wiki 网状知识图谱"><header class="network-heading"><div><span class="network-eyebrow">MY KNOWLEDGE NETWORK</span><h2>${escape(data.profile || '')} · Wiki 网状图谱</h2></div><span class="network-count">${knowledge.length} 个知识点 · ${nodes.filter(n => n.kind === 'material').length} 份资料</span></header><div class="network-stage"><svg class="network-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-label="可拖动、缩放的知识关系图"><rect class="network-pan-surface" width="${WIDTH}" height="${HEIGHT}"/><g class="network-viewport" transform="translate(${model.saved.view.x} ${model.saved.view.y}) scale(${model.saved.view.scale})"><g class="network-edges">${edges.map(e => edgeMarkup(e, model)).join('')}</g><g class="network-nodes">${nodes.map(n => nodeMarkup(n, model.selectedIndex)).join('')}</g></g></svg>${knowledge.length ? '' : '<p class="network-empty">先建立学习框架，再慢慢织成自己的知识网。</p>'}<div class="network-controls" role="group" aria-label="图谱视图"><button type="button" data-network-action="zoom-in" aria-label="放大图谱">＋</button><button type="button" data-network-action="zoom-out" aria-label="缩小图谱">−</button><button type="button" data-network-action="reset" aria-label="重置图谱视图">⌖</button></div><span class="network-view-hint">拖动圆点整理位置 · 拖空白移动 · 滚轮缩放</span></div><div class="network-legend"><span><i class="network-dot-knowledge"></i>知识点：越熟练，圆越大</span><span><i class="network-dot-material"></i>已保存资料</span><span><i class="network-dot-goal"></i>学习目标</span></div><p class="network-score-note">圆大小表示<strong>方向参考测验掌握度</strong>，按每道题最近的作答更新；未答为 0%，新答错会缩小。聊天和收藏不会增加掌握度。</p><p class="network-link-note">连线来自目标归属、已保存资料和 Wiki 引用；紫色虚线为起步课程建议关联。可在笔记里用 [[知识点完整名称]] 建立自己的连接。</p><p class="network-selection-status" data-network-status role="status" aria-live="polite"></p></section>`;
  }
  function render(data, options = {}) {
    pending = build(data || {}, options.selectedIndex);
    return markup(pending);
  }
  function paintView(state) {
    const v = state.model.saved.view;
    state.viewport.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.scale.toFixed(3)})`);
  }
  function paintPositions(state) {
    for (const [id, element] of state.nodeElements) {const n = state.model.byId.get(id); if (n) element.setAttribute('transform', `translate(${n.x.toFixed(2)} ${n.y.toFixed(2)})`);}
    for (const element of state.edgeElements) {
      const a = state.model.byId.get(element.dataset.networkFrom), b = state.model.byId.get(element.dataset.networkTo);
      if (a && b) {element.setAttribute('x1', a.x.toFixed(2)); element.setAttribute('y1', a.y.toFixed(2)); element.setAttribute('x2', b.x.toFixed(2)); element.setAttribute('y2', b.y.toFixed(2));}
    }
  }
  function localPoint(state, event) {
    const rect = state.svg.getBoundingClientRect(), width = rect.width || WIDTH, height = rect.height || HEIGHT;
    const scale = Math.min(width / WIDTH, height / HEIGHT);
    return {x:(number(event.clientX) - rect.left - (width - WIDTH * scale) / 2) / scale, y:(number(event.clientY) - rect.top - (height - HEIGHT * scale) / 2) / scale};
  }
  function zoom(state, factor, point = {x:WIDTH / 2, y:HEIGHT / 2}) {
    const v = state.model.saved.view, scale = clamp(v.scale * factor, .55, 2.4), ratio = scale / v.scale;
    v.x = point.x - (point.x - v.x) * ratio; v.y = point.y - (point.y - v.y) * ratio; v.scale = scale;
    v.x = clamp(v.x, -WIDTH * 1.8, WIDTH * 1.8); v.y = clamp(v.y, -HEIGHT * 1.8, HEIGHT * 1.8);
    paintView(state);
  }
  function mount(onSelect) {
    dispose();
    const root = global.document.querySelector('[data-study-network]');
    if (!root || !pending || root.dataset.networkScope !== pending.key) return false;
    const state = {root, model:pending, onSelect, svg:root.querySelector('.network-svg'), viewport:root.querySelector('.network-viewport'), nodeElements:new Map(), edgeElements:Array.from(root.querySelectorAll('.network-edge')), cleanups:[], pointer:null, suppressClick:false};
    root.querySelectorAll('[data-network-id]').forEach(el => state.nodeElements.set(el.dataset.networkId, el));
    active = state;
    const listen = (target, event, fn, options) => {target.addEventListener(event, fn, options); state.cleanups.push(() => target.removeEventListener(event, fn, options));};
    const select = index => {
      if (!Number.isInteger(index) || !state.model.byId.has('knowledge:' + index) || active !== state) return;
      const current = global.StudyApp?.getContext?.();
      if (global.StudyRole?.isSwitching?.() || current && scopeKey(current) !== state.model.key) return;
      state.model.selectedIndex = index;
      for (const el of state.nodeElements.values()) if (el.dataset.networkKind === 'knowledge') {const chosen = Number(el.dataset.nodeIndex) === index; el.classList.toggle('is-selected', chosen); el.setAttribute('aria-pressed', String(chosen));}
      const n = state.model.byId.get('knowledge:' + index), status = root.querySelector('[data-network-status]');
      if (status) status.textContent = `${n.name} · 参考测验掌握度 ${n.score}%`;
      if (typeof state.onSelect === 'function') state.onSelect(index);
    };
    listen(root, 'click', event => {
      const control = event.target.closest?.('[data-network-action]');
      if (control) {
        const action = control.dataset.networkAction;
        if (action === 'reset') {Object.assign(state.model.saved.view, {scale:1, x:0, y:0}); paintView(state);}
        else zoom(state, action === 'zoom-in' ? 1.2 : 1 / 1.2);
        return;
      }
      const target = event.target.closest?.('[data-network-kind="knowledge"]');
      if (target) {if (state.suppressClick) {state.suppressClick = false; event.preventDefault(); return;} select(Number(target.dataset.nodeIndex));}
    });
    listen(root, 'keydown', event => {const target = event.target.closest?.('[data-network-kind="knowledge"]'); if (target && ['Enter',' '].includes(event.key)) {event.preventDefault(); select(Number(target.dataset.nodeIndex));}});
    listen(state.svg, 'wheel', event => {event.preventDefault(); zoom(state, event.deltaY > 0 ? 1 / 1.12 : 1.12, localPoint(state, event));}, {passive:false});
    listen(state.svg, 'pointerdown', event => {
      if (event.button !== undefined && event.button !== 0 || state.pointer) return;
      const target = event.target.closest?.('[data-network-kind="knowledge"]'), point = localPoint(state, event);
      const v = state.model.saved.view, n = target ? state.model.byId.get(target.dataset.networkId) : null;
      state.suppressClick = false;
      state.pointer = {id:event.pointerId, start:point, last:point, node:n, moved:false, offset:n ? {x:(point.x - v.x) / v.scale - n.x, y:(point.y - v.y) / v.scale - n.y} : null};
      state.svg.classList.add(n ? 'is-node-dragging' : 'is-panning');
      try {state.svg.setPointerCapture?.(event.pointerId);} catch (_) {}
    });
    listen(global.document, 'pointermove', event => {
      const p = state.pointer; if (!p || event.pointerId !== p.id) return;
      const point = localPoint(state, event), v = state.model.saved.view;
      if (Math.hypot(point.x - p.start.x, point.y - p.start.y) > 5) p.moved = true;
      if (p.node) {
        p.node.x = (point.x - v.x) / v.scale - p.offset.x; p.node.y = (point.y - v.y) / v.scale - p.offset.y; bound(p.node);
        state.model.saved.positions.set(p.node.id, {x:p.node.x, y:p.node.y}); paintPositions(state);
      } else {v.x = clamp(v.x + point.x - p.last.x, -WIDTH * 1.8, WIDTH * 1.8); v.y = clamp(v.y + point.y - p.last.y, -HEIGHT * 1.8, HEIGHT * 1.8); paintView(state);}
      p.last = point;
    });
    const endPointer = event => {const p = state.pointer; if (!p || event.pointerId !== p.id) return; state.suppressClick = Boolean(p.node && p.moved); state.pointer = null; state.svg.classList.remove('is-node-dragging', 'is-panning'); try {state.svg.releasePointerCapture?.(event.pointerId);} catch (_) {}};
    listen(global.document, 'pointerup', endPointer); listen(global.document, 'pointercancel', endPointer);
    paintView(state); return true;
  }
  function refresh(data, options = {}) {
    const root = global.document.querySelector('[data-study-network]'); if (!root) return false;
    const previous = active?.onSelect, selectedIndex = options.selectedIndex ?? active?.model.selectedIndex;
    dispose(); root.outerHTML = render(data, {selectedIndex}); return mount(previous);
  }
  function dispose() {
    if (!active) return;
    for (const cleanup of active.cleanups) cleanup();
    if (active.pointer) {try {active.svg.releasePointerCapture?.(active.pointer.id);} catch (_) {}}
    active.pointer = null; active.svg.classList.remove('is-node-dragging', 'is-panning'); active = null;
  }
  global.addEventListener('pagehide', dispose);
  global.addEventListener('study-role-leaving', dispose);
  global.addEventListener('study-workspace-reset', event => {const role = event.detail?.roleId; for (const key of caches.keys()) if (key.startsWith(role + ':')) caches.delete(key); if (active?.model.data.roleId === role) dispose();});
  global.StudyNetwork = Object.freeze({render, mount, refresh, dispose});
})(window);
