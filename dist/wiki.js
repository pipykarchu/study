/* The Wiki is a view over the current role's existing learning records. */
(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const directions = [['product','AI 产品'],['coding','Vibe Coding'],['fde','FDE'],['custom','自定主题']];
  const stageNames = ['框架与边界','抓住核心','分段练习','主动测验','项目应用','费曼复述','速查复习'];
  const states = new Map(), requests = new Set();
  let context = null, renderedKey = '', renderedRoute = null, leaving = false, requestEpoch = 0;
  const scope = data => ({roleId:data.roleId,profileId:data.profileId});
  const keyOf = data => `${data.roleId}:${data.profileId}`;
  const current = () => global.StudyApp?.getContext?.() || context;
  const same = target => !leaving && !global.StudyRole?.isSwitching?.() && current() && keyOf(current()) === keyOf(target) && renderedKey === keyOf(target);
  function entry(data = context) {
    const key = keyOf(data);
    if (!states.has(key)) states.set(key, {nodeIndex:0,pane:'wiki',mode:'chat',notes:new Map(),query:'',onlyNode:false,material:{title:'',type:'note',content:'',url:'',nodeIndex:null},adding:false,editing:null,removeId:null,message:'',error:false,ima:{checked:false,configured:false,verified:false,busy:false,libraries:[],results:[],query:'',message:'',error:false,pending:null,uncertain:new Set()}});
    return states.get(key);
  }
  const refresh = () => global.StudyApp?.refresh?.();
  function announce(text, error = false, state = entry()) {
    state.message = text; state.error = error;
    const el = document.querySelector('[data-wiki-message]');
    if (el && context && entry() === state) { el.textContent = text; el.classList.toggle('is-error',error); el.hidden = !text; }
  }
  function safeUrl(value) { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } }
  function materials(data=context, filtered=true) {
    const state=entry(data);
    return global.StudyApp?.listMaterials?.(filtered ? {query:state.query,...(state.onlyNode ? {nodeIndex:state.nodeIndex} : {})} : {}) || [];
  }
  function node(data=context) { return (data.nodes || []).find(n=>n.index===entry(data).nodeIndex) || data.nodes?.[0]; }
  function stageState(data) { try { return global.StudyLearning?.get(data.profileId) || {stage:'frame',completedStages:[],quiz:{bestScore:null}}; } catch (_) { return {stage:'frame',completedStages:[],quiz:{bestScore:null}}; } }
  function stages(data) {
    const learning=stageState(data), all=global.StudyLearning?.stages || stageNames.map((title,i)=>({id:['frame','core','learn','quiz','project','feynman','review'][i],title}));
    return `<section class="wiki-method" aria-label="十倍学习方法的七个步骤"><div class="wiki-method-label"><strong>十倍学习 · 七步路径</strong><span>先框架，再输入；有产出，才算留下。</span></div><ol>${all.map((s,i)=>`<li><button data-wiki-action="stage" data-stage="${esc(s.id)}" class="${learning.stage===s.id?'is-current ':''}${learning.completedStages.includes(s.id)?'is-done':''}" ${learning.stage===s.id?'aria-current="step"':''}><span>${learning.completedStages.includes(s.id)?'✓':i+1}</span>${stageNames[i]||esc(s.title)}</button></li>`).join('')}</ol><p>“10 倍”是方法来源的标题；进度来自学习产出和实际测验，不按对话数量累加。</p></section>`;
  }
  function graph(data) {
    const selected=entry(data).nodeIndex, positions=[[17,22],[50,22],[83,22],[83,71],[50,71],[17,71]];
    return `<section class="wiki-map-card" aria-label="${esc(data.roleName)}的知识图谱"><div class="wiki-map-heading"><div><span class="wiki-eyebrow">MY PERSONAL WIKI</span><h2>${esc(data.profile)} · 知识图谱</h2></div><span class="wiki-map-scale">6 个知识节点</span></div><div class="wiki-map-scene"><div class="wiki-map-horizon" aria-hidden="true"></div><svg class="wiki-map-lines" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wiki-route" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bba3cf"/><stop offset="1" stop-color="#d5b8b7"/></linearGradient></defs><ellipse cx="500" cy="420" rx="442" ry="145" class="wiki-map-ground"/><ellipse cx="500" cy="420" rx="350" ry="108" class="wiki-map-orbit"/><ellipse cx="500" cy="420" rx="245" ry="73" class="wiki-map-orbit"/><path d="M170 137 C270 112 375 112 500 137 S710 162 830 137 C960 200 955 380 830 440 C710 465 630 465 500 440 S290 415 170 440" class="wiki-map-route"/></svg><div class="wiki-map-center" aria-hidden="true"><span class="wiki-crystal">✦</span><strong>${esc(data.roleName)}的 Wiki</strong><small>每一页，都连着一个小目标</small></div>${(data.nodes||[]).map((n,i)=>`<button class="wiki-node ${n.index===selected?'is-selected':''} ${n.completed?'is-recorded':''}" data-wiki-action="node" data-node="${n.index}" style="--node-x:${positions[i]?.[0]||50}%;--node-y:${positions[i]?.[1]||50}%;--node-order:${i}" aria-pressed="${n.index===selected}" aria-controls="wiki-panel" aria-label="${i+1}. ${esc(n.name)}，${n.completed?'已记录自测':'待学习'}"><span class="wiki-node-number">${String(i+1).padStart(2,'0')}</span><span class="wiki-node-book" aria-hidden="true"><span></span></span><strong>${esc(n.name)}</strong><span class="wiki-node-status">${n.completed?'✓ 已记录自测':n.note?'已有学习笔记':'打开这一页'}<span aria-hidden="true">↗</span></span></button>`).join('')}</div><div class="wiki-map-legend"><span><i></i>连线表示建议学习顺序</span><span>点任一节点，在右侧直接开始</span></div></section>`;
  }
  function nodeWiki(data) {
    const n=node(data);if(!n)return '<p class="wiki-empty">先保存一个学习框架，就能开始写自己的 Wiki。</p>';
    const state=entry(data), note=state.notes.has(n.index)?state.notes.get(n.index):n.note||'';
    return `<article class="wiki-node-page"><div class="wiki-page-heading"><span class="wiki-paper-tag">WIKI ${String(n.index+1).padStart(2,'0')}</span><span>${n.completed?'✓ 已记录自测':'从理解开始'}</span></div><h3>${esc(n.name)}</h3><p class="wiki-node-description">${esc(n.description)}</p><div class="wiki-practice-card"><span class="wiki-small-label">这次动手做</span><p>${esc(n.exercise)}</p></div><div class="wiki-acceptance"><span class="wiki-small-label">怎样算做到了</span><p>${esc(n.acceptance)}</p></div><div class="wiki-pane-actions"><button class="button primary small" data-wiki-action="chat">和 Codex 学这一页 ↗</button><button class="button secondary small" data-wiki-action="quiz">做一次主动回忆</button></div><form data-wiki-note-form><label class="field">我的理解与练习证据<textarea name="note" data-wiki-note rows="5" maxlength="20000" placeholder="合上资料，用自己的话解释；留下做法、结果或还没想明白的问题。">${esc(note)}</textarea></label><div class="wiki-note-actions"><button class="button secondary small" type="submit">保存本页笔记</button><button class="text-button" type="button" data-wiki-action="collect-note">沉淀到资料库 ↗</button></div></form><p class="wiki-small-print">笔记与资料会归入当前角色、当前学习方向。框架变化后，请核对旧笔记是否适用。</p></article>`;
  }
  function materialForm(data) {
    const state=entry(data), draft=state.material;
    return `<form class="wiki-material-form" data-wiki-material-form><h4>${state.editing?'编辑这份资料':'留下学习过程中的一份资料'}</h4><label class="field">标题<input name="title" maxlength="300" required value="${esc(draft.title)}" placeholder="例如：我第一次把需求变成原型"></label><div class="wiki-form-row"><label class="field">资料类型<select name="type"><option value="note" ${draft.type==='note'?'selected':''}>笔记 / 学习产出</option><option value="link" ${draft.type==='link'?'selected':''}>网页链接</option>${draft.type==='file'?'<option value="file" selected>导入的文本</option>':''}</select></label><label class="field">关联 Wiki 节点<select name="nodeIndex"><option value="" ${draft.nodeIndex===null?'selected':''}>整个学习方向</option>${(data.nodes||[]).map(n=>`<option value="${n.index}" ${n.index===draft.nodeIndex?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label></div><label class="field">原始链接（可选）<input name="url" type="url" maxlength="2000" value="${esc(draft.url)}" placeholder="https://…"></label><label class="field">笔记 / 摘要 / 阶段产出<textarea name="content" rows="5" maxlength="10000" placeholder="留下为什么有用、自己的理解，以及下一次怎么用。">${esc(draft.content)}</textarea></label><label class="wiki-file-input">＋ 导入 .md / .txt<input type="file" data-wiki-file accept=".md,.txt,text/plain,text/markdown"></label><span class="wiki-small-print">最大 80 KB、正文 10000 字。标题保留原文件名。</span><div class="wiki-pane-actions"><button class="button primary small" type="submit">${state.editing?'保存修改':'保存到我的资料库'}</button><button type="button" class="button secondary small" data-wiki-action="close-material-form">收起</button></div></form>`;
  }
  function materialCard(item,data) {
    const state=entry(data), linked=(data.nodes||[]).find(n=>n.index===item.nodeIndex), href=safeUrl(item.url), removing=state.removeId===item.id;
    return `<article class="wiki-material-card" data-material-id="${esc(item.id)}"><div class="wiki-material-meta"><span>${item.type==='link'?'网页链接':item.type==='file'?'文本资料':'学习笔记'}${linked?' · '+esc(linked.name):' · '+esc(data.profile)}</span><time datetime="${esc(new Date(item.updatedAt).toISOString())}">${esc(new Date(item.updatedAt).toLocaleDateString('zh-CN'))}</time></div><h4>${esc(item.title)}</h4>${item.content?`<p class="wiki-material-excerpt">${esc(item.content.slice(0,120))}${item.content.length>120?'…':''}</p><details class="wiki-material-content"><summary>展开正文</summary><div>${esc(item.content)}</div></details>`:''}${href?`<a class="text-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">打开原始资料 ↗</a>`:''}<div class="wiki-material-actions"><button class="text-button" data-wiki-action="learn-material" data-id="${esc(item.id)}">带着这份资料学习 ↗</button><button class="text-button" data-wiki-action="edit-material" data-id="${esc(item.id)}">编辑</button><button class="text-button" data-wiki-action="export-material" data-id="${esc(item.id)}">导出</button><button class="text-button" data-wiki-action="ima-preview" data-id="${esc(item.id)}">存入 ima ↗</button><button class="text-button danger" data-wiki-action="remove-material" data-id="${esc(item.id)}">删除</button></div>${removing?`<div class="wiki-remove-confirm" role="alert"><span>从当前角色的资料库移除这份资料？</span><button class="text-button danger" data-wiki-action="confirm-remove" data-id="${esc(item.id)}">确认删除</button><button class="text-button" data-wiki-action="cancel-remove">保留</button></div>`:''}</article>`;
  }
  function imaPanel(data) {
    const state=entry(data), ima=state.ima, target=global.StudyApp?.getImaTarget?.(), pending=ima.pending, disable=ima.busy?'disabled':'';
    return `<section class="wiki-ima"><div class="wiki-ima-heading"><div><span class="wiki-small-label">继续沉淀到腾讯 ima</span><h4>自己的资料，随时找回来</h4></div><span class="wiki-status-dot ${ima.configured?'is-ready':''}">${ima.configured?'已配置':'待连接'}</span></div><p class="wiki-small-print">${ima.checked&&!ima.configured?'连接尚未配置。先在官方平台申请凭证，再由站点所有者设置；网页不会索要或保存密钥。':target?'当前方向关联：'+esc(target.name):'先检查连接，选择当前学习方向对应的知识库。'}资料需要你确认后才会保存到 ima。</p><div class="wiki-pane-actions"><button class="button secondary small" data-wiki-action="ima-check" ${disable}>${ima.busy?'正在处理…':ima.checked?'重新检查连接':'检查 ima 连接'}</button><a class="text-button" href="https://ima.qq.com/agent-interface" target="_blank" rel="noopener noreferrer">官方连接设置 ↗</a></div>${ima.verified?`<label class="field">当前方向的 ima 知识库<select data-wiki-ima-library ${disable}><option value="">请选择知识库</option>${target&&!ima.libraries.some(l=>l.id===target.id)?`<option value="${esc(target.id)}" selected>${esc(target.name)}</option>`:''}${ima.libraries.map(l=>`<option value="${esc(l.id)}" ${target?.id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>${ima.libraryCursor?'<button class="text-button" data-wiki-action="ima-more-libraries">加载更多知识库</button>':''}${target?`<form class="wiki-ima-search" data-wiki-ima-search><label class="sr-only" for="wiki-ima-query">搜索 ima 知识库</label><input type="search" id="wiki-ima-query" value="${esc(ima.query)}" maxlength="200" placeholder="在这个 ima 知识库中搜索"><button class="button secondary small" ${disable}>搜索</button></form>${ima.results.length?`<div class="wiki-ima-results">${ima.results.map(r=>`<details><summary>${esc(r.title)}</summary><p>${esc(r.content)}</p></details>`).join('')}</div>`:''}${ima.resultCursor?'<button class="text-button" data-wiki-action="ima-more-results">加载更多结果</button>':''}`:''}`:''}<p class="wiki-ima-message ${ima.error?'is-error':''}" role="status">${esc(ima.message)}</p>${pending?`<div class="wiki-ima-preview"><h4>确认存入 ima</h4><p class="wiki-small-print">目的知识库：${esc(pending.target.name)} · ${esc(data.roleName)} / ${esc(data.profile)}</p><strong>${esc(pending.title)}</strong><pre>${esc(pending.content.slice(0,1000))}${pending.content.length>1000?'\n…（其余内容将一同保存）':''}</pre><p class="wiki-small-print">${pending.title.length<materials(data,false).find(m=>m.id===pending.materialId)?.title.length?'ima 标题最多 180 字，预览显示的是保存标题。':''}</p><div class="wiki-pane-actions"><button class="button primary small" data-wiki-action="ima-confirm" ${ima.busy||!ima.verified||ima.uncertain.has(pending.materialId)?'disabled':''}>${ima.busy?'正在保存…':ima.uncertain.has(pending.materialId)?'先去 ima 确认结果':'确认保存到 ima'}</button><button class="button secondary small" data-wiki-action="ima-cancel" ${disable}>收起</button></div></div>`:''}</section>`;
  }
  function library(data) {
    const state=entry(data), found=materials(data), all=materials(data,false);
    return `<section class="wiki-library"><div class="wiki-library-heading"><div><h3>把学习过程，留成自己的资料</h3><p>${esc(data.roleName)} · ${esc(data.profile)} · ${all.length} 份资料</p></div><button class="button secondary small" data-wiki-action="add-material">＋ 添加</button></div><div class="wiki-library-search"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" data-wiki-library-query value="${esc(state.query)}" placeholder="搜索笔记、资料和原始链接" aria-label="搜索当前方向的资料"></label><label class="wiki-node-filter"><input type="checkbox" data-wiki-node-filter ${state.onlyNode?'checked':''}>只看本节点</label></div>${state.adding?materialForm(data):''}<div class="wiki-material-list">${found.length?found.map(m=>materialCard(m,data)).join(''):`<div class="wiki-empty"><span aria-hidden="true">▤</span><strong>${all.length?'没有找到匹配资料':'这里留给你真正学过的东西'}</strong><p>${all.length?'换个关键词，或取消“只看本节点”。':'学习笔记、卡住的地方、做过的练习、参考链接，都可以放在这里。'}</p></div>`}</div>${all.length?'<button class="text-button" data-wiki-action="export-all">导出当前方向的全部资料 ↗</button>':''}${imaPanel(data)}<details class="wiki-data-settings"><summary>备份与管理当前角色的记录</summary><p class="wiki-small-print">完整备份包含当前角色各学习方向的记录。导入或重置前，请先导出一份备份。</p><div class="wiki-pane-actions"><button class="button secondary small" data-action="export-json">导出完整备份</button><button class="button secondary small" data-action="import">导入备份</button><button class="text-button" data-action="export-md">导出学习框架</button><button class="text-button danger" data-action="reset-data">重置当前角色</button></div></details></section>`;
  }
  function pane(data) {
    const state=entry(data), n=node(data);
    const coachOptions={nodeIndex:state.nodeIndex};if(state.mode)coachOptions.mode=state.mode;
    const body=state.pane==='materials'?library(data):state.pane==='chat'?(global.studyCoach?.renderEmbedded?.(data,coachOptions)||'<p class="wiki-empty">对话组件正在准备，请刷新后再试。</p>'):nodeWiki(data);
    if(state.pane==='chat')state.mode=null;
    return `<aside class="wiki-workbench" aria-label="${esc(n?.name||'知识节点')}的学习工作台"><div class="wiki-workbench-top"><span class="wiki-eyebrow">LEARN IN THE SAME PLACE</span><strong>${esc(n?.name||data.profile)}</strong></div><div class="wiki-pane-tabs" role="tablist" aria-label="当前节点的学习环境">${[['wiki','节点 Wiki'],['chat','对话 / 练习'],['materials','沉淀资料']].map(([id,label])=>`<button role="tab" id="wiki-tab-${id}" aria-selected="${state.pane===id}" aria-controls="wiki-panel" class="${state.pane===id?'is-active':''}" data-wiki-action="pane" data-pane="${id}">${label}</button>`).join('')}</div><div id="wiki-panel" class="wiki-panel" role="tabpanel" aria-labelledby="wiki-tab-${state.pane}">${body}</div></aside>`;
  }
  function render(data, options = {}) {
    if (!data) return '';
    if (renderedKey && renderedKey!==keyOf(data)) abortRequests();
    const applyInitialPane=renderedKey!==keyOf(data)||renderedRoute!==location.hash||!context;
    context=data;renderedKey=keyOf(data);renderedRoute=location.hash;leaving=false;
    const state=entry(data);if(applyInitialPane&&options.pane&&['wiki','chat','materials'].includes(options.pane))state.pane=options.pane;
    const learning=stageState(data), checked=(data.nodes||[]).filter(n=>n.completed).length;
    return `<div class="study-wiki" id="study-wiki" data-wiki-scope="${esc(renderedKey)}"><header class="wiki-header"><div class="wiki-identity"><span class="wiki-avatar ${data.roleId==='apple'?'is-pixiu':''}" aria-hidden="true">${esc(data.roleAvatar)}</span><div><span class="wiki-eyebrow">A LITTLE WIKI, A GROWING WORLD</span><h1>${esc(data.roleName)}的知识世界</h1><p>从自己的地图出发，在一处学、练、留下成果。</p></div></div><div class="wiki-progress"><span><strong>${checked}</strong> / 6 节点自测记录</span><span><strong>${learning.quiz.bestScore===null||learning.quiz.bestScore===undefined?'—':learning.quiz.bestScore+'分'}</strong> 完整测验最高</span></div></header><div class="wiki-directions" role="group" aria-label="选择学习方向">${directions.map(([id,label])=>`<button data-action="profile" data-id="${id}" class="${data.profileId===id?'is-current':''}" aria-pressed="${data.profileId===id}">${label}</button>`).join('')}<span>各自的目标、笔记与资料，归入当前空间</span></div><section class="wiki-goal-bar"><span class="wiki-goal-marker" aria-hidden="true">◎</span><div><span class="wiki-small-label">这一次，我想做到</span><h2>${esc(data.goal||'写下一个具体的学习目标')}</h2><p>产出：${esc(data.outcome||'先定义一份能检查的学习成果')}<span> · 每次 ${esc(data.minutes||45)} 分钟</span></p></div><button class="text-button" data-wiki-action="goal">编辑目标 ↗</button></section><details class="wiki-goal-editor" data-wiki-goal-editor><summary>直接写下目标，让 Codex 生成框架</summary>${global.StudyPlanner?.render?.(data)||'<button class="button secondary small" data-action="edit-goal">编辑学习目标</button>'}</details><div class="wiki-workspace">${graph(data)}${pane(data)}</div><p class="wiki-inline-message ${state.error?'is-error':''}" data-wiki-message role="status" ${state.message?'':'hidden'}>${esc(state.message)}</p><details class="wiki-boundaries"><summary>学习边界 <span>先弄清哪些要学，哪些可以先放下</span></summary><div class="wiki-boundary-grid">${[['must','这次必学'],['optional','有余力再学'],['later','暂时不学']].map(([id,label])=>`<div><h3>${label}</h3><ul>${(data.boundaries?.[id]||[]).map(v=>`<li>${esc(v)}</li>`).join('')||'<li>还没有写下这份清单</li>'}</ul></div>`).join('')}</div><button class="text-button" data-action="edit-boundary">调整学习边界 ↗</button></details>${stages(data)}</div>`;
  }
  function mount() { if(entry().pane==='chat')global.studyCoach?.mount?.(); }
  function openPane(mode='wiki',index) {
    const data=current();if(!data)return false;
    const state=entry(data);
    if(Number.isInteger(index)&&index>=0&&index<6)state.nodeIndex=index;
    state.pane=['chat','quiz','review'].includes(mode)?'chat':mode==='materials'?'materials':'wiki';
    if(['chat','quiz','review'].includes(mode))state.mode=mode;
    refresh();return true;
  }
  function materialById(id) { return materials(context,false).find(m=>m.id===id); }
  function markdown(item,data) { return `# ${item.title}\n\n> ${data.roleName} / ${data.profile}${item.nodeIndex===null?'':' / '+((data.nodes||[]).find(n=>n.index===item.nodeIndex)?.name||'知识节点')}\n\n${item.url?'来源：'+item.url+'\n\n':''}${item.content||''}\n`; }
  function download(text,name) {
    const blob=new Blob([text],{type:'text/markdown;charset=utf-8'}), url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function abortRequests() { requestEpoch++;for(const item of requests)item.abort();requests.clear(); }
  async function imaRequest(path,body,target) {
    const epoch=requestEpoch,controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch('/api/ima/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...scope(target)})}:{}),signal:controller.signal});
      const result=await response.json();
      if(epoch!==requestEpoch||!same(target))throw Error('学习空间已变化，这次结果不会放入当前空间。');
      if(!response.ok) { const error=Error(result.error||'ima 暂时没有响应，请稍后再试。');if(typeof result.mayHaveSaved==='boolean')error.mayHaveSaved=result.mayHaveSaved;error.noteId=result.noteId;throw error; }
      if(body&&(result.roleId!==target.roleId||result.profileId!==target.profileId))throw Error('ima 返回的学习空间不匹配，已丢弃结果。');
      return result;
    } finally { clearTimeout(timeout);requests.delete(controller); }
  }
  async function imaAction(action,id) {
    const target={...context}, state=entry(target), ima=state.ima;
    if(ima.busy)return;
    if(action==='ima-preview') {
      const item=materialById(id), selected=global.StudyApp?.getImaTarget?.();state.pane='materials';
      if(!item)return;
      if(!ima.verified||!selected){ima.message='先检查 ima 连接并读取知识库，再保存这份资料。';ima.error=true;refresh();return;}
      const content=markdown(item,target);
      ima.pending={materialId:item.id,title:item.title.slice(0,180),content,target:{...selected}};ima.message='确认标题、正文与目的知识库后，再点击保存。';ima.error=false;refresh();return;
    }
    if(action==='ima-cancel'){ima.pending=null;refresh();return;}
    if(action==='ima-confirm'&&(!ima.verified||!ima.pending||ima.uncertain.has(ima.pending.materialId)))return;
    ima.busy=true;ima.error=false;ima.message='正在连接 ima…';refresh();
    try {
      if(action==='ima-check') {
        ima.verified=false;ima.pending=null;
        const status=await imaRequest('status',null,target);if(!same(target))return;
        ima.checked=true;ima.configured=status.configured===true;
        if(!ima.configured){ima.message='暂未配置连接。你仍可以在这里保存、搜索和导出资料。';return;}
        const result=await imaRequest('libraries',{},target);if(!same(target))return;
        ima.libraries=result.libraries||[];ima.libraryCursor=result.isEnd?null:result.nextCursor;ima.verified=true;
        ima.message=ima.libraries.length?'已读取你的 ima 知识库。请选择当前学习方向对应的库。':'连接已通过，暂时没有可选择的知识库。';
      } else if(action==='ima-more-libraries') {
        if(!ima.configured||!ima.libraryCursor)return;
        const result=await imaRequest('libraries',{cursor:ima.libraryCursor},target);if(!same(target))return;
        ima.libraries=[...ima.libraries,...(result.libraries||[]).filter(l=>!ima.libraries.some(p=>p.id===l.id))];ima.libraryCursor=result.isEnd?null:result.nextCursor;ima.message='知识库列表已更新。';
      } else if(action==='ima-search'||action==='ima-more-results') {
        const selected=global.StudyApp.getImaTarget();if(!ima.verified||!selected)throw Error('请先检查连接并选择 ima 知识库。');
        const result=await imaRequest('search',{kbId:selected.id,query:ima.query,...(action==='ima-more-results'?{cursor:ima.resultCursor}:{})},target);if(!same(target))return;
        if(result.kbId!==selected.id||global.StudyApp.getImaTarget()?.id!==selected.id)throw Error('目的知识库已变化，请重新搜索。');
        ima.results=action==='ima-more-results'?[...ima.results,...(result.results||[])]:result.results||[];ima.resultCursor=result.isEnd?null:result.nextCursor;
        ima.message=ima.results.length?'已读取知识库资料，点击标题展开正文。':'没有找到资料，可以换个关键词。';
      } else if(action==='ima-confirm') {
        const pending=ima.pending;
        if(!pending||global.StudyApp.getImaTarget()?.id!==pending.target.id)throw Error('目的知识库已变化，请重新确认资料。');
        let result;
        try { result=await imaRequest('save-note',{kbId:pending.target.id,title:pending.title,content:pending.content},target); }
        catch(error) { if(error.mayHaveSaved!==false){ima.uncertain.add(pending.materialId);error.message='保存结果尚不确定，请先到 ima 查看，避免重复创建。';}throw error; }
        if(result.kbId!==pending.target.id||result.saved!==true) {ima.uncertain.add(pending.materialId);throw Error('保存结果尚不确定，请先到 ima 查看，避免重复创建。');}
        ima.message='已保存到 ima：'+pending.target.name+'。'+(result.warnings?.length?' '+result.warnings.join('；'):'');ima.pending=null;
      }
    } catch(error) {ima.error=true;ima.message=error.name==='AbortError'?'连接超时，请稍后检查。':error.message;}
    finally {ima.busy=false;if(same(target))refresh();}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-wiki-action]');if(!button||!button.closest('#study-wiki')||!context)return;
    const target=scope(context), state=entry();if(!same(target))return;
    const action=button.dataset.wikiAction,index=Number(button.dataset.node),id=button.dataset.id;
    if(action.startsWith('ima-')){event.preventDefault();void imaAction(action,id);return;}
    try {
      if(action==='node'){state.nodeIndex=index;state.pane='wiki';state.message='';refresh();}
      else if(action==='pane'){state.pane=button.dataset.pane;refresh();}
      else if(['chat','quiz','review'].includes(action))openPane(action);
      else if(action==='goal'){const details=document.querySelector('[data-wiki-goal-editor]');details.open=true;details.querySelector('input')?.focus();details.scrollIntoView?.({behavior:'smooth',block:'nearest'});}
      else if(action==='stage'){global.StudyLearning?.setStage(context.profileId,button.dataset.stage);openPane(button.dataset.stage==='quiz'?'quiz':button.dataset.stage==='review'?'review':'chat');}
      else if(action==='collect-note'){
        const n=node(),text=(state.notes.has(n.index)?state.notes.get(n.index):n.note||'').trim();if(!text)throw Error('先写下自己的理解，再沉淀到资料库。');
        state.pane='materials';state.adding=true;state.editing=null;state.material={type:'note',title:n.name+' · 学习笔记',content:text.slice(0,10000),url:'',nodeIndex:n.index};refresh();if(text.length>10000)announce('资料正文最多 10000 字，已放入前 10000 字，请检查后再保存。');
      } else if(action==='add-material'){state.adding=true;state.editing=null;state.material={title:'',type:'note',content:'',url:'',nodeIndex:state.nodeIndex};refresh();}
      else if(action==='close-material-form'){state.adding=false;refresh();}
      else if(action==='edit-material'){const item=materialById(id);if(!item)return;state.adding=true;state.editing=id;state.material={title:item.title,type:item.type,content:item.content,url:item.url,nodeIndex:item.nodeIndex};refresh();}
      else if(action==='remove-material'){state.removeId=id;refresh();}
      else if(action==='cancel-remove'){state.removeId=null;refresh();}
      else if(action==='confirm-remove'){state.removeId=null;global.StudyApp.removeMaterial(id,target);announce('这份资料已从当前角色的资料库移除。');}
      else if(action==='export-material'){const item=materialById(id);if(item)download(markdown(item,context),item.title+'.md');}
      else if(action==='export-all'){download(materials(context,false).map(m=>markdown(m,context)).join('\n---\n\n'),context.roleName+'-'+context.profile+'-学习资料.md');}
      else if(action==='learn-material'){
        const item=materialById(id);if(!item)return;
        const prompt=`我想用这份资料学习当前目标。请先指出它对应知识框架的哪一部分，再用一个小练习检验我的理解，先不要给答案。\n资料标题：${item.title}\n${item.url?'来源：'+item.url+'\n':''}资料内容（节选）：\n${item.content.slice(0,5400)}`;
        openPane('chat');
        if(!global.studyCoach?.prepare?.(prompt.slice(0,6000),target))throw Error('当前对话还在回答，请先停止回答，再带着这份资料学习。');
        state.pane='chat';state.mode='chat';refresh();announce('资料已放入当前对话，请检查后点击发送。');
      }
    } catch(error){announce(error.message,true);}
  });
  document.addEventListener('input',event=>{
    const field=event.target;if(!field.closest?.('#study-wiki')||!context||!same(scope(context)))return;
    const state=entry();
    if(field.matches('[data-wiki-note]'))state.notes.set(state.nodeIndex,field.value);
    if(field.closest('[data-wiki-material-form]')&&field.name){state.material[field.name]=field.name==='nodeIndex'?(field.value===''?null:Number(field.value)):field.value;}
    if(field.matches('[data-wiki-library-query]')){
      state.query=field.value;const position=field.selectionStart;refresh();const next=document.querySelector('[data-wiki-library-query]');next?.focus();try{next?.setSelectionRange(position,position);}catch(_){}
    }
    if(field.id==='wiki-ima-query')state.ima.query=field.value;
  });
  document.addEventListener('change',async event=>{
    const field=event.target;if(!field.closest?.('#study-wiki')||!context||!same(scope(context)))return;
    const target=scope(context), state=entry();
    if(field.matches('[data-wiki-node-filter]')){state.onlyNode=field.checked;refresh();}
    if(field.closest('[data-wiki-material-form]')&&field.name)state.material[field.name]=field.name==='nodeIndex'?(field.value===''?null:Number(field.value)):field.value;
    if(field.matches('[data-wiki-ima-library]')){
      if(state.ima.busy)return;const library=state.ima.libraries.find(l=>l.id===field.value);
      state.ima.results=[];state.ima.pending=null;state.ima.resultCursor=null;state.ima.message='';
      try{global.StudyApp.setImaTarget(library||null,target);}catch(error){announce(error.message,true);}return;
    }
    if(field.matches('[data-wiki-file]')){
      const file=field.files?.[0];if(!file)return;const epoch=requestEpoch,draftAtRead=JSON.stringify(state.material);
      try{
        if(!/\.(md|txt)$/i.test(file.name)||file.size>80*1024)throw Error('请选择不超过 80 KB 的 .md 或 .txt 文本。');
        const buffer=typeof file.arrayBuffer==='function'?await file.arrayBuffer():await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取这份文件。'));reader.readAsArrayBuffer(file);});
        const content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
        if(epoch!==requestEpoch||!same(target))return;if(JSON.stringify(state.material)!==draftAtRead)throw Error('资料草稿已经变化，这次文件导入没有覆盖新内容，请重新选择文件。');if(content.length>10000)throw Error('正文超过 10000 字，请先分成几份学习资料。');
        state.material={...state.material,type:'file',title:file.name,content,url:''};refresh();announce('文本已读入，检查后点击保存到资料库。');
      }catch(error){if(same(target))announce(error.name==='TypeError'?'文件不是有效 UTF-8 文本，请先转成 UTF-8 后再导入。':error.message,true);}
    }
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.closest?.('#study-wiki')||!context||!same(scope(context)))return;
    if(!form.matches('[data-wiki-note-form],[data-wiki-material-form],[data-wiki-ima-search]'))return;
    event.preventDefault();const target=scope(context),state=entry();
    try{
      if(form.matches('[data-wiki-note-form]')){const value=form.elements.note.value;global.StudyApp.recordNote(state.nodeIndex,value);state.notes.delete(state.nodeIndex);announce('当前 Wiki 页的学习笔记已保存。');}
      else if(form.matches('[data-wiki-material-form]')){
        const input={...state.material,title:state.material.title.trim(),content:state.material.content.trim(),url:state.material.url.trim()};
        if(!input.title)throw Error('给这份资料起一个标题。');if(input.url&&!safeUrl(input.url))throw Error('链接需要以 http:// 或 https:// 开头。');
        if(input.type==='link'&&!input.url)throw Error('网页资料需要填写原始链接。');if(!input.content&&!input.url)throw Error('请留下正文或一个原始链接。');
        const editing=state.editing;state.adding=false;state.editing=null;
        try { if(editing)global.StudyApp.updateMaterial(editing,input,target);else global.StudyApp.addMaterial(input,target); }
        catch(error){state.adding=true;state.editing=editing;throw error;}
        state.material={title:'',type:'note',content:'',url:'',nodeIndex:state.nodeIndex};announce('资料已保存在当前角色、当前学习方向。');
      }else if(form.matches('[data-wiki-ima-search]'))void imaAction('ima-search');
    }catch(error){announce(error.message,true);}
  });
  global.addEventListener('study-role-leaving',()=>{leaving=true;abortRequests();});
  global.addEventListener('study-workspace-reset',event=>{const roleId=event.detail?.roleId;if(!['apple','sheep'].includes(roleId))return;for(const key of states.keys())if(key.startsWith(roleId+':'))states.delete(key);if(context?.roleId===roleId)abortRequests();});
  global.addEventListener('pagehide',()=>{leaving=true;abortRequests();});
  global.addEventListener('pageshow',()=>{leaving=false;});
  global.StudyWiki=Object.freeze({render,mount,getFocus:()=>context?entry().nodeIndex:null,openPane,renderLibrary:data=>{entry(data).pane='materials';return render(data);}});
})(window);
