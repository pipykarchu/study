'use strict';
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const local = ['127.0.0.1','localhost'].includes(location.hostname);
  const localUrl = 'http://127.0.0.1:4175/#coach';
  let context = {}, messages = [], conversationId = null, token = null;
  let status = null, sending = false, checking = false, draft = '', includeContext = true;
  let activeRequest = null, stopRequested = false;
  const select = s => document.querySelector(s);
  const starters = ['先问我三个问题，帮我确定学习起点。','帮我把这个目标拆成知识框架，划清必学和暂不学的边界。','围绕我的学习目标，一次问我一道题，先不要给答案。','我想用自己的话解释一个概念，请你帮我找理解漏洞。'];
  function contextText() {
    if (!includeContext) return '';
    const b = context.boundaries || {};
    return `学习方向：${context.profile || ''}\n目标：${context.goal || ''}\n用途：${context.why || ''}\n验收作品：${context.outcome || ''}\n每次时间：${context.minutes || 45} 分钟\n必须掌握：${(b.must || []).join('；')}\n按需了解：${(b.optional || []).join('；')}\n暂时不学：${(b.later || []).join('；')}`.slice(0,12000);
  }
  function stateText() {
    if (!local) return '云端私有版 · 在本机版连接 Codex';
    if (checking || !status) return '正在检查本机 Codex…';
    if (!status.available) return status.message || '本机 Codex 连接未就绪';
    if (!status.authenticated) return '请先在本机 Codex 中登录';
    return `已连接你的 Codex${status.model ? ' · ' + status.model : ''}`;
  }
  function connection() {
    if (!local) return `<div class="coach-connection offline"><span class="coach-status-dot"></span><div><strong>使用你电脑里已登录的 Codex</strong><p>云端私有网站可以正常浏览。直接问答请打开本机学习版，电脑和连接服务需要保持开启。</p></div><a class="button primary small" href="${localUrl}">打开本机学习版 ↗</a></div>`;
    return `<div class="coach-connection ${status?.authenticated ? 'online' : 'offline'}"><span class="coach-status-dot"></span><div><strong id="coach-status-text">${escape(stateText())}</strong><p>${escape(status?.modelNotice || '优先使用本机模型设置，为学习新建独立对话。')}</p></div><button class="button secondary small" data-coach-action="retry" ${checking ? 'disabled' : ''}>${checking ? '检查中…' : '检查连接'}</button></div>`;
  }
  function messageList() {
    if (!messages.length) return `<div class="coach-welcome"><span class="coach-welcome-flower" aria-hidden="true">✿</span><h2>你好，今天想弄懂什么？</h2><p>从一个具体问题开始，让你的 Codex 陪你学。</p><div class="coach-starters">${starters.map((s,i)=>`<button class="coach-starter" data-coach-action="starter" data-starter="${i}">${escape(s)} <span>↗</span></button>`).join('')}</div></div>`;
    return messages.map(m=>`<article class="coach-message ${m.role}"${m.error?' data-error="true"':''}><span class="coach-message-avatar" aria-hidden="true">${m.role==='user'?'我':'✦'}</span><div><strong>${m.role==='user'?'我':'我的 Codex'}</strong><div class="coach-message-text">${escape(m.text || (sending && m.role==='assistant' ? '正在想一想…' : '回答已停止。'))}</div></div></article>`).join('');
  }
  function render(data) {
    context = data;
    return `<section class="page-heading"><div><div class="eyebrow">YOUR CODEX STUDY PARTNER</div><h1>和自己的 Codex，一起学 <span class="heading-flower">✿</span></h1><p class="heading-description">直接提问、梳理框架、逐题练习，让学习有来有回。</p></div><button class="button secondary" data-coach-action="new" ${sending?'disabled':''}>＋ 开始新对话</button></section><div id="coach-connection">${connection()}</div><div class="coach-layout"><section class="coach-chat panel" aria-label="Codex 学习对话"><div class="coach-messages" id="coach-messages" role="log" aria-live="polite" aria-relevant="additions text">${messageList()}</div><div class="coach-error" id="coach-error" role="alert" hidden></div><form class="coach-composer" id="coach-form"><label class="sr-only" for="coach-input">向自己的 Codex 提问</label><textarea id="coach-input" rows="3" maxlength="8000" placeholder="说说你想弄懂的问题……" ${!local?'disabled':''}>${escape(draft)}</textarea><div class="coach-compose-actions"><span>Enter 发送 · Shift + Enter 换行</span>${sending?'<button type="button" class="button secondary small" data-coach-action="stop">停止回答</button>':'<button type="submit" class="button primary small" id="coach-send" '+(!local||!status?.authenticated?'disabled':'')+'>发送给我的 Codex ↗</button>'}</div></form><p class="coach-footnote">对话暂保留在当前标签页；你原来的 Codex 聊天不会自动带入这里。</p></section><aside class="coach-context panel"><div class="section-kicker">LEARN WITH YOUR CONTEXT</div><h2>让它了解你的学习目标</h2><label class="check-row"><input type="checkbox" id="coach-context-toggle" ${includeContext?'checked':''}><span class="check-title">提问时带上目标和学习边界</span></label><dl><dt>这次想做到</dt><dd>${escape(context.goal)}</dd><dt>用什么证明学会</dt><dd>${escape(context.outcome)}</dd><dt>这次先不学</dt><dd>${(context.boundaries?.later||[]).map(t=>`<span class="coach-scope-item">${escape(t)}</span>`).join('')}</dd></dl><button class="text-button" data-action="edit-goal">调整我的学习目标 ↗</button><div class="coach-context-tip"><span>🌱</span><p>回答太多时，可以说“先讲最重要的一个概念，举一个例子，等我说懂了再继续”。</p></div><div class="coach-context-note">登录信息留在本机。这个学习助手用于解释与练习，不替你修改文件或操作电脑。</div></aside></div>`;
  }
  function updateMessages() {
    const list = select('#coach-messages');
    if (!list) return;
    const nearBottom = list.scrollHeight-list.scrollTop-list.clientHeight<150;
    list.innerHTML = messageList();
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }
  function updateForm() {
    const actions = select('.coach-compose-actions');
    if (actions) actions.innerHTML = `<span>Enter 发送 · Shift + Enter 换行</span>${sending?'<button type="button" class="button secondary small" data-coach-action="stop">停止回答</button>':`<button type="submit" class="button primary small" id="coach-send" ${!local||!status?.authenticated?'disabled':''}>发送给我的 Codex ↗</button>`}`;
    const fresh = select('[data-coach-action="new"]'); if(fresh)fresh.disabled=sending;
  }
  function error(message) {const el=select('#coach-error');if(el){el.textContent=message;el.hidden=false;}}
  async function request(path, body, signal) {
    return fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token||''},body:JSON.stringify(body),...(signal?{signal}:{})});
  }
  async function check() {
    if (!local || checking) return;
    checking=true;
    const panel=select('#coach-connection');if(panel)panel.innerHTML=connection();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
    try {
      const r=await fetch('/api/codex/session',{cache:'no-store',signal:controller.signal});
      if(!r.ok)throw Error('请用“启动知芽”打开支持 Codex 的本机版。');
      const session=await r.json(); if(typeof session.token!=='string')throw Error('本机连接没有就绪，请重新启动本机版。'); token=session.token;
      const health=await fetch('/api/codex/status',{cache:'no-store',signal:controller.signal});
      if(!health.ok)throw Error('本机 Codex 暂时没有响应，稍后再检查连接。');
      status=await health.json();
    } catch(e) {status={available:false,authenticated:false,message:e.name==='AbortError'?'连接检查超时，请稍后重试。':e.message};}
    finally {clearTimeout(timeout);checking=false;const panel=select('#coach-connection');if(panel)panel.innerHTML=connection();updateForm();}
  }
  async function send(text) {
    if(sending || !local)return;
    if(!status?.authenticated){error('先检查连接，确认本机 Codex 已登录。');return;}
    text=text.trim();if(!text)return;
    sending=true;stopRequested=false;const controller=new AbortController();activeRequest=controller;const err=select('#coach-error');if(err)err.hidden=true;
    draft='';const input=select('#coach-input');if(input)input.value='';
    messages.push({role:'user',text},{role:'assistant',text:''});const answer=messages[messages.length-1];updateMessages();updateForm();
    let terminal=false;
    try {
      const r=await request('/api/codex/chat',{message:text,context:contextText(),...(conversationId?{conversationId}:{})},controller.signal);
      if(!r.ok){let detail;try{detail=await r.json();}catch{}throw Error(detail?.message||detail?.error||`本机服务暂时无法回答（${r.status}），请检查连接后重试。`);}
      if(!r.body)throw Error('浏览器没有收到回答数据，请重试。');
      const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
      function handle(line){if(!line.trim())return;const event=JSON.parse(line);if(event.type==='conversation')conversationId=event.conversationId;else if(event.type==='delta'){answer.text+=event.text||'';updateMessages();}else if(event.type==='done')terminal=true;else if(event.type==='error')throw Error(event.message||'这次回答没有完成。');}
      while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)handle(line);}
      buffer+=decoder.decode();if(buffer.trim())handle(buffer);
      if(!terminal)throw Error('连接中断了，已收到的回答保留在上面。');
    } catch(e){if(e.name==='AbortError'&&stopRequested){if(!answer.text)answer.text='这次回答已停止。';}else{answer.error=true;if(!answer.text)answer.text='这次没有收到完整回答。';error(e.message);}}
    finally {controller.abort();activeRequest=null;sending=false;updateMessages();updateForm();}
  }
  document.addEventListener('submit',e=>{if(e.target.id!=='coach-form')return;e.preventDefault();send(select('#coach-input').value);});
  document.addEventListener('keydown',e=>{if(e.target.id==='coach-input'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value);}});
  document.addEventListener('input',e=>{if(e.target.id==='coach-input')draft=e.target.value;});
  document.addEventListener('change',e=>{if(e.target.id==='coach-context-toggle')includeContext=e.target.checked;});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-coach-action]');if(!b)return;
    if(b.dataset.coachAction==='retry')check();
    else if(b.dataset.coachAction==='starter'){const input=select('#coach-input');if(input&&!input.disabled){draft=starters[Number(b.dataset.starter)]||'';input.value=draft;input.focus();}}
    else if(b.dataset.coachAction==='new'&&!sending){messages=[];conversationId=null;const err=select('#coach-error');if(err)err.hidden=true;updateMessages();}
    else if(b.dataset.coachAction==='stop'&&sending){b.disabled=true;b.textContent='正在停止…';stopRequested=true;activeRequest?.abort();if(conversationId){try{const r=await request('/api/codex/cancel',{conversationId});if(!r.ok)throw Error('停止请求未被确认，请检查连接状态。');}catch(e){error(e.message);}}}
  });
  window.studyCoach={render,mount(){updateMessages();if(local&&!status&&!checking)check();},getContextText:contextText};
})();
