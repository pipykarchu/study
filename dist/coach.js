'use strict';
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const select = s => document.querySelector(s);
  const fallbackStages = [
    {id:'frame',title:'知识框架',description:'先说清要解决什么问题、学到哪里就够用。'},
    {id:'core',title:'抓住核心',description:'从框架里挑出最影响结果的概念与联系。'},
    {id:'learn',title:'分段练习',description:'一次学一小段，合上资料自己做一道。'},
    {id:'quiz',title:'模拟测验',description:'不看答案独立作答，找出真正的薄弱点。'},
    {id:'project',title:'项目应用',description:'把知识用到自己的真实项目，并留下一份产出。'},
    {id:'feynman',title:'费曼复述',description:'不用术语堆砌，用自己的话讲清楚。'},
    {id:'review',title:'速查复习',description:'把关键方法压成速查表，再安排回忆与重测。'}
  ];
  let context = {}, token = null, status = null, checking = false, includeContext = true;
  let activeRequest = null, mode = 'chat', feedback = '', sessionStorageAvailable = true, pageLeaving = false;
  let embedded = false, focusedNodeIndex = null;
  const sessions = new Map(), positions = new Map(), choices = new Map(), evidenceDrafts = new Map();
  const learning = () => window.StudyLearning;
  const profileKey = () => String(context.profileId || 'product');
  const scope = () => ({roleId:context.roleId || window.StudyRole?.id || 'apple',profileId:profileKey()});
  const scopeKey = (value = scope()) => `${value.roleId}:${value.profileId}`;
  const sameScope = value => {
    const current = window.StudyApp?.getContext?.() || scope();
    return !pageLeaving && !window.StudyRole?.isSwitching?.() && scopeKey(value) === scopeKey() && scopeKey(value) === scopeKey(current);
  };
  const chatKey = value => `study-coach-chat-v2:${value.profileId}${value.roleId === 'sheep' ? ':sheep' : ''}`;
  const stages = () => learning()?.stages || fallbackStages;
  const snapshot = () => learning()?.get(profileKey()) || {stage:'frame',completedStages:[],quiz:{attempts:[],bestScore:null,lastScore:null},recentEvidence:[]};
  const stageInfo = () => stages().find(s => s.id === snapshot().stage) || stages()[0];
  const sending = () => Boolean(activeRequest);
  function session() {
    const target = scope(), key = scopeKey(target);
    if (!sessions.has(key)) {
      let saved = {};
      try { saved = JSON.parse(sessionStorage.getItem(chatKey(target)) || '{}'); }
      catch { sessionStorageAvailable = false; }
      const messages = Array.isArray(saved?.messages) ? saved.messages.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.text === 'string').slice(-60).map(m => ({role:m.role,text:m.text.slice(0,80000),error:Boolean(m.error),completed:m.completed === true,nodeIndex:Number.isInteger(m.nodeIndex) && m.nodeIndex >= 0 && m.nodeIndex < 6 ? m.nodeIndex : null,nodeTitle:typeof m.nodeTitle === 'string' ? m.nodeTitle.slice(0,160) : ''})) : [];
      sessions.set(key, {scope:target,messages, conversationId:null, draft:typeof saved?.draft === 'string' ? saved.draft.slice(0,8000) : ''});
    }
    return sessions.get(key);
  }
  function saveSession(value) {
    try { sessionStorage.setItem(chatKey(value.scope), JSON.stringify({messages:value.messages.slice(-60),draft:value.draft})); }
    catch { sessionStorageAvailable = false; }
  }
  function focusedNode() {
    if (!Number.isInteger(focusedNodeIndex)) return null;
    return (context.nodes || []).find(n => n.index === focusedNodeIndex) || context.nodes?.[focusedNodeIndex] || null;
  }
  function focusedContext() {
    const node = focusedNode();
    if (!node) return '';
    return `\n当前选中的 Wiki 节点：${focusedNodeIndex} · ${String(node.name || '').slice(0,160)}\n节点说明：${String(node.description || '').slice(0,1200)}\n节点练习：${String(node.exercise || '').slice(0,1200)}\n节点验收：${String(node.acceptance || '').slice(0,1200)}\n这个节点的已有笔记：${String(node.note || '').slice(0,2000)}\n请优先围绕这个节点讲解和练习；笔记和聊天数量不代表已掌握。\n`;
  }
  function contextText() {
    if (!includeContext) return '';
    const b = context.boundaries || {}, st = stageInfo();
    return `学习角色：${context.roleName || window.StudyRole?.name || '貔貅'}（${context.roleId || window.StudyRole?.id || 'apple'}）\n学习方向：${context.profile || ''}\n目标：${String(context.goal || '').slice(0,1200)}\n用途：${String(context.why || '').slice(0,800)}\n验收作品：${String(context.outcome || '').slice(0,800)}\n每次时间：${context.minutes || 45} 分钟\n必须掌握：${(b.must || []).join('；').slice(0,1200)}\n按需了解：${(b.optional || []).join('；').slice(0,600)}\n暂时不学：${(b.later || []).join('；').slice(0,600)}\n当前学习阶段：${st.title}${focusedContext()}\n知识节点：${(context.nodes || []).map(n => `${n.name}：${n.description || ''}；练习：${n.exercise || ''}；验收：${n.acceptance || ''}`).join('\n').slice(0,3500)}\n教学要求：用中文大白话，一次只推进一个小问题，先问再讲，练习和测验先不给答案；不要因我发了消息就宣称掌握。`.slice(0,12000);
  }
  function stateText() {
    if (checking || !status) return '正在检查我的 Codex…';
    if (!status.available) return status.message || (local ? '本机 Codex 连接未就绪' : '连接电脑未运行，记录和测验仍可用');
    const ownerErrors = {owner_not_configured:'本机尚未绑定站点所有者，请回到 Codex 完成本人账号校验',owner_mismatch:'当前 Codex 账号与站点所有者不一致，暂不允许问答',codex_login_required:'请先在本机 Codex 官方客户端中登录',account_changed:'检测到 Codex 账号已切换，请重新检查本人身份'};
    if (status.authError) return ownerErrors[status.authError] || '未能确认站点所有者身份，请重新检查连接';
    if (!status.authenticated || (!local && !status.ownerVerified)) return local ? '请先在本机 Codex 官方客户端中登录' : '请在连接电脑登录本站所有者的 Codex，再检查连接';
    return `已连接你的 Codex${status.model ? ' · ' + status.model : ''}`;
  }
  function connection() {
    return `<div class="coach-connection ${status?.authenticated && (local || status?.ownerVerified) ? 'online' : 'offline'}"><span class="coach-status-dot"></span><div><strong id="coach-status-text">${escape(stateText())}</strong><p>${escape(status?.modelNotice || (local ? '沿用本机已有登录与模型设置。账号登录只在 Codex 官方客户端完成，本站不索取密码。' : '使用你自己的 Codex 会员额度，受套餐用量限制。连接电脑需保持运行；无需另填 API 密钥。'))}</p></div><button class="button secondary small" data-coach-action="retry" ${checking ? 'disabled' : ''}>${checking ? '检查中…' : '检查连接'}</button></div>`;
  }
  function promptFor(id) {
    const node = focusedNode(), target = node?.name || context.goal || '我的学习目标';
    const prompts = {
      frame:node ? `我正在学习 Wiki 节点“${target}”。请先用一个问题确认我已有的基础，再说明这个节点在整体框架中的作用、必学边界和一个最小例子。一次只推进一个小问题，等我回答后再继续。` : `我想做到：${target}。请先问我三个定位问题，再和我一起搭知识框架，分清必学、按需了解、暂时不学。每次只问一个问题，等我回答。`,
      core:`围绕“${target}”，请从我的知识框架里挑出最关键的概念和它们的联系，解释为什么优先学。一次只讲一个概念，用我的项目举例，再问我一个理解问题。`,
      learn:`请带我围绕“${target}”做分段练习。${node?.exercise ? `节点练习是：${String(node.exercise).slice(0,1200)}。` : ''}先挑一个小知识点，给一个最小例子，再出一道需要我自己完成的练习；等我回答后再反馈，不要先给答案。`,
      quiz:`请根据“${target}”和我的知识框架模拟测验。一次一道题，先不给答案；等我独立作答后，指出对错和原因，再给下一题。最后总结薄弱点。`,
      project:`请把“${target}”用到我的项目。先帮我定一个本次时间内能完成的小产出和验收标准，再让我自己做。请检查我提供的产出，不要直接替我宣称掌握。`,
      feynman:`我要用自己的话复述“${target}”的一个核心概念。请先让我解释给零基础的人听，等我说完后再指出含糊、遗漏和错误，用追问帮我修正。`,
      review:`请帮我把“${target}”压缩成一页速查表：关键概念、操作步骤、常见误区、一个例子和自测问题。先让我凭记忆写提纲，再帮我补漏，并建议复习时间。`
    };
    return prompts[id] || prompts.frame;
  }
  function stageGuide() {
    const st = stageInfo(), done = snapshot().completedStages.includes(st.id);
    const specific = {
      frame:focusedNode() ? `当前 Wiki 节点：${focusedNode().name}。先说清它解决什么问题、边界在哪里，再用最小例子开始。` : `本次目标：${context.goal || '先设置一个能验证的目标'}。先定用途和验收作品，再把范围分成“必学 / 按需 / 暂不学”。`,
      core:'在框架里选 1～3 个最关键的概念，用一句话写出它们为什么重要、彼此怎么联系。',
      learn:`一次只练一个小点。${focusedNode()?.exercise || context.nodes?.[0]?.exercise || '先自己做，再对照解释，记录卡住的位置。'}`,
      quiz:'进入“模拟测试”，先独立作答再看解析。完整测验覆盖知识节点且达到 80%，才记录本阶段完成。',
      project:`把方法用到自己的项目，留下可检查的产出。你的验收作品：${context.outcome || '补充一个作品或实际结果'}。`,
      feynman:'想象对面是一个新手：这个概念解决什么问题？怎么做？举什么例子？不用看资料先说清。',
      review:'把概念、步骤、易错点和例子写成一页速查表。然后合上它，凭记忆回答，再回到错题复测。'
    };
    return `<article class="coach-learning-guide"><div class="coach-guide-avatar" aria-hidden="true">🌱</div><div><div class="coach-guide-label">学习引导 <span>本站步骤提示 · 不是 AI 回答</span></div><h2>${escape(st.title)}${done ? '<span class="coach-done-tag">已记录完成</span>' : ''}</h2><p>${escape(specific[st.id])}</p><div class="coach-guide-actions"><button class="button soft small" data-coach-action="stage-prompt">填入这一步的提问 ↗</button>${st.id === 'quiz' ? '<button class="button primary small" data-coach-action="mode" data-mode="quiz">开始模拟测试</button>' : ''}</div></div></article>`;
  }
  function messageList() {
    const messages = session().messages;
    if (!messages.length) return `<div class="coach-welcome"><span class="coach-welcome-flower" aria-hidden="true">✿</span><h2>先画一张地图，再一点点学会</h2><p>在这里直接提问。Codex 可以读取本角色的目标、修改框架、记笔记和带你测验；保存成功后才会确认。</p><div class="coach-starters"><button class="coach-starter" data-coach-action="stage-prompt">从当前这一步开始 <span>↗</span></button><button class="coach-starter" data-coach-action="question-start">先问我一个问题，看看我会多少 <span>↗</span></button></div></div>`;
    return messages.map((m,i) => `<article class="coach-message ${m.role}"${m.error ? ' data-error="true"' : ''}><span class="coach-message-avatar" aria-hidden="true">${m.role === 'user' ? escape(context.roleAvatar || window.StudyRole?.avatar || '🐾') : '✦'}</span><div><strong>${m.role === 'user' ? '我' : '我的 Codex · 实际回答'}</strong><div class="coach-message-text">${escape(m.text || (sending() && m.role === 'assistant' ? '正在想一想…' : '回答已停止。'))}</div>${m.role === 'assistant' && m.completed && !m.error && m.text ? `<button class="text-button coach-save-answer" data-coach-action="save-answer" data-message-index="${i}" ${sending() ? 'disabled' : ''}>沉淀这条回答 ↗</button>` : ''}</div></article>`).join('');
  }
  function formActions() {
    return `<span>Enter 发送 · Shift + Enter 换行</span><div class="coach-send-buttons"><button type="button" class="text-button" data-coach-action="copy-prompt">备用：复制问题</button>${sending() ? '<button type="button" class="button secondary small" data-coach-action="stop">停止回答</button>' : `<button type="submit" class="button primary small" id="coach-send" ${!status?.available || !status?.authenticated || (!local && !status?.ownerVerified) ? 'disabled' : ''}>发送给我的 Codex ↗</button>`}</div>`;
  }
  function evidencePanel() {
    const st = stageInfo(), key = `${scopeKey()}:${st.id}`;
    if (st.id === 'quiz') return '<div class="coach-evidence-note">测验阶段由完整测试成绩记录完成，不能手动勾选。错题复测用于补漏，不代替完整测验。</div>';
    const previous = snapshot().recentEvidence.slice().reverse().find(e => e.stage === st.id || e.stageId === st.id);
    return `<form id="coach-evidence-form" class="coach-evidence"><label for="coach-evidence"><strong>留下自己的学习证据</strong><span>写下你的框架、练习结果、作品说明或复述。记录完成不代表 AI 已验证掌握。</span></label>${previous ? `<details class="coach-saved-evidence"><summary>查看这一步最近的产出</summary><p>${escape(previous.text)}</p></details>` : ''}<textarea id="coach-evidence" rows="2" maxlength="2000" placeholder="例如：我能用自己的话解释……；我做出了……，验收结果是……">${escape(evidenceDrafts.get(key) || '')}</textarea><div class="coach-evidence-actions"><small>${previous ? '这一步已有记录，可以补充新的产出。' : '先留下一条自己的产出，再记录这一步。'}</small><button type="submit" class="button secondary small">记录完成这一步 ✓</button></div></form>`;
  }
  function chatPanel() {
    return `<div id="coach-guide">${stageGuide()}</div><div class="coach-messages" id="coach-messages" role="log" aria-live="polite" aria-relevant="additions text">${messageList()}</div><form class="coach-composer" id="coach-form"><label class="sr-only" for="coach-input">向自己的 Codex 提问</label><textarea id="coach-input" rows="3" maxlength="8000" placeholder="先写一个具体问题，或者点上方按钮填入阶段提问……">${escape(session().draft)}</textarea><div class="coach-compose-actions">${formActions()}</div></form><p class="coach-footnote">${sessionStorageAvailable ? '对话草稿留在当前标签页；刷新后开启新会话。' : '浏览器禁止保存草稿，刷新后文字会丢失。'}${local ? ' 问答由本机 Codex 处理。' : ' 问答经私人云端临时中转，会员连接电脑需保持开机。'} 登录凭据不会写入网页存储。</p>${evidencePanel()}`;
  }
  const nodeName = i => context.nodes?.[i]?.name || `知识节点 ${Number(i) + 1}`;
  function quizSummary(q) {
    const answers = q.answers || [], correct = answers.filter(a => a.correct).length;
    const score = q.score ?? Math.round(correct / Math.max(1,q.total || q.questions.length) * 100);
    const weak = [...new Set(answers.filter(a => !a.correct).map(a => a.nodeIndex))];
    return `<div class="coach-test-summary"><span class="coach-summary-flower" aria-hidden="true">${score >= 80 ? '🌸' : '🌱'}</span><div class="coach-test-score">${score}<small>分</small></div><h2>${q.kind === 'review' ? '本轮错题复测已完成' : score >= 80 ? '这次基础检查通过了' : '找到要补的一小块了'}</h2><p>答对 ${correct} / ${q.total || q.questions.length} 题。${q.kind === 'review' ? '这是错题复测，不作为完整测验通过记录。' : '这是本站参考题的成绩，不等于真实项目已经掌握。'}</p>${weak.length ? `<div class="coach-weak-points"><strong>优先补这些</strong>${weak.map(i => `<span>${escape(nodeName(i))}</span>`).join('')}</div>` : '<p>下一步，把方法用在自己的项目里，再留下一份产出。</p>'}<div class="coach-test-actions"><button class="button primary" data-coach-action="quiz-start">重新做完整测验</button><button class="button secondary" data-coach-action="mode" data-mode="review">看看错题与复习</button></div></div>`;
  }
  function quizPanel() {
    const q = learning()?.getQuiz(profileKey());
    if (q?.finished) return quizSummary(q);
    if (!q || !q.questions?.length) return `<div class="coach-test-intro"><span class="coach-summary-flower" aria-hidden="true">✎</span><div class="section-kicker">CHECK WHAT YOU CAN RECALL</div><h2>不看答案，才知道哪里需要再练</h2><p>围绕当前学习方向，做一轮覆盖知识节点的小测验。每题提交后才显示答案和解释；完成整轮后记录真实成绩。</p><div class="coach-test-rules"><span>每次一道题</span><span>提交后看解析</span><span>答错进入错题本</span></div><button class="button primary" data-coach-action="quiz-start" ${!learning() ? 'disabled' : ''}>开始完整模拟测验 ↗</button><p class="coach-source-note">模拟题是本站练习参考题，不是视频原题。学习方法不保证“10 倍”效果。</p></div>`;
    let position = positions.get(scopeKey());
    if (!Number.isInteger(position) || position >= q.questions.length) { position = q.questions.findIndex(item => !(q.answers || []).some(a => a.questionId === item.id)); if (position < 0) position = q.questions.length - 1; positions.set(scopeKey(), position); }
    const item = q.questions[position], answer = (q.answers || []).find(a => a.questionId === item.id);
    const selected = answer ? answer.choiceIndex : choices.get(`${scopeKey()}:${q.id}:${item.id}`);
    return `<div class="coach-test-question"><div class="coach-test-topline"><span>${q.kind === 'review' ? '错题复测' : '完整模拟测验'}</span><span>第 ${position + 1} / ${q.questions.length} 题 · 已答 ${q.answered || 0} 题</span></div><div class="coach-test-progress" role="progressbar" aria-label="本轮答题进度" aria-valuenow="${q.answered || 0}" aria-valuemin="0" aria-valuemax="${q.questions.length}"><span style="width:${(q.answered || 0) / q.questions.length * 100}%"></span></div><span class="coach-question-node">${escape(nodeName(item.nodeIndex))}</span><h2>${escape(item.prompt)}</h2><form id="coach-quiz-form" data-question-id="${escape(item.id)}"><fieldset class="coach-options" ${answer ? 'disabled' : ''}><legend class="sr-only">选择一个答案</legend>${item.options.map((text,i) => `<label class="coach-option ${answer && i === answer.correctIndex ? 'is-correct' : ''} ${answer && i === answer.choiceIndex && !answer.correct ? 'is-wrong' : ''}"><input type="radio" name="coach-answer" value="${i}" ${selected === i ? 'checked' : ''}><span class="coach-option-letter">${String.fromCharCode(65 + i)}</span><span>${escape(text)}</span>${answer && i === answer.correctIndex ? '<span class="coach-answer-mark">✓</span>' : ''}</label>`).join('')}</fieldset>${answer ? `<div class="coach-answer-feedback ${answer.correct ? 'correct' : 'incorrect'}" role="status"><strong>${answer.correct ? '✓ 这道题答对了' : '这道题还需要再想一想'}</strong><p>${escape(answer.explanation)}</p>${!answer.correct ? '<small>已放入错题本；答错不会算作通过。</small>' : ''}</div><div class="coach-test-actions">${position < q.questions.length - 1 ? '<button type="button" class="button primary" data-coach-action="quiz-next">下一题 →</button>' : '<button type="button" class="button primary" data-coach-action="quiz-finish">查看本轮成绩</button>'}${position > 0 ? '<button type="button" class="button secondary" data-coach-action="quiz-back">上一题</button>' : ''}</div>` : `<div class="coach-test-actions"><button type="submit" class="button primary" id="coach-quiz-submit" ${selected === undefined ? 'disabled' : ''}>提交这一题</button><span class="coach-test-hint">先选一个答案，提交后才会显示解析。</span></div>`}</form><p class="coach-source-note">本站练习参考题 · 每题只计首次提交 · 可离开页面后继续本轮</p></div>`;
  }
  function reviewPanel() {
    const wrong = learning()?.getReview(profileKey()) || [], saved = snapshot();
    if (!wrong.length) return `<div class="coach-test-intro"><span class="coach-summary-flower" aria-hidden="true">🌿</span><h2>${saved.quiz.attempts?.length ? '当前没有待重做的错题' : '错题本还空着'}</h2><p>${saved.quiz.attempts?.length ? '下一步可以做完整测验，或用自己的项目检验应用能力。' : '先做一次模拟测试。答错的知识点会留在这里，帮助你有针对性地复习。'}</p><button class="button primary" data-coach-action="mode" data-mode="quiz">去做模拟测试 ↗</button></div>`;
    return `<div class="coach-review"><div class="coach-review-heading"><div><div class="section-kicker">CLOSE THE SMALL GAPS</div><h2>${wrong.length} 道题，慢慢补回来</h2><p>先回忆自己的答案，再展开解析。重做答对后，才移出待复习错题。</p></div><button class="button primary small" data-coach-action="review-start">只重做错题 ↗</button></div>${wrong.map((item,i) => `<article class="coach-review-item"><span class="coach-question-node">${escape(nodeName(item.nodeIndex))}</span><h3>${i + 1}. ${escape(item.prompt)}</h3><details><summary>我回忆过了，查看解析</summary><p><strong>参考答案：</strong>${escape(item.options?.[item.correctIndex] || '')}</p><p>${escape(item.explanation)}</p></details></article>`).join('')}<p class="coach-source-note">错题复测用于补漏，完整测验仍需覆盖全部节点并达到 80%。</p></div>`;
  }
  function sidebar() {
    const saved = snapshot(), all = stages(), completed = saved.completedStages || [], st = stageInfo();
    const wrong = learning()?.getReview(profileKey()) || [], best = saved.quiz.bestScore, last = saved.quiz.lastScore;
    const storage = learning()?.getStorageStatus?.();
    return `<div class="coach-progress-heading"><div><div class="section-kicker">MY LEARNING PATH</div><h2>一点点看见自己的进步</h2></div><span aria-hidden="true">✿</span></div><div class="coach-goal-box"><span>我的学习目标</span><strong>${escape(context.goal || '先设置一个具体目标')}</strong><button class="text-button" data-action="edit-goal">调整目标 ↗</button></div><div class="coach-progress-label"><strong>${completed.length}<small> / ${all.length} 步已记录完成</small></strong><span>${Math.round(completed.length / all.length * 100)}%</span></div><div class="coach-path-progress" role="progressbar" aria-label="已记录完成的学习步骤" aria-valuenow="${completed.length}" aria-valuemin="0" aria-valuemax="${all.length}"><span style="width:${completed.length / all.length * 100}%"></span></div><ol class="coach-stage-list">${all.map((s,i) => `<li><button data-coach-action="stage" data-stage="${s.id}" class="${s.id === st.id ? 'is-current' : ''} ${completed.includes(s.id) ? 'is-complete' : ''}" ${s.id === st.id ? 'aria-current="step"' : ''}><span class="coach-stage-number">${completed.includes(s.id) ? '✓' : i + 1}</span><span>${escape(s.title)}<small>${completed.includes(s.id) ? '已记录完成' : s.id === st.id ? '当前这一步' : '待学习'}</small></span><span class="coach-stage-arrow">↗</span></button></li>`).join('')}</ol><div class="coach-score-grid"><div><span>完整测验最高</span><strong>${best === null || best === undefined ? '—' : best + '<small>分</small>'}</strong></div><div><span>待复习错题</span><button class="coach-score-link" data-coach-action="mode" data-mode="review">${wrong.length}<small>道 ↗</small></button></div></div><p class="coach-score-caption">${last === null || last === undefined ? '还没有完成的完整测验，先独立做一轮吧。' : `最近完整测验 ${last} 分。成绩来自实际提交，不按聊天数量累加。`}</p><div class="coach-next-step"><span>接下来</span><p>${escape(st.description || fallbackStages.find(s => s.id === st.id)?.description || '')}</p><button class="text-button" data-coach-action="stage-prompt">${local ? '带着这个问题问 Codex' : '生成这一步的提问'} ↗</button></div><label class="check-row coach-include-context"><input type="checkbox" id="coach-context-toggle" ${includeContext ? 'checked' : ''}><span class="check-title">提问时带上目标和学习边界</span></label><div class="coach-context-note">${storage?.available === false ? '<strong>浏览器禁止保存学习记录。</strong>本次仍可练习，关页后可能丢失，请及时导出备份。' : '记录会先保留在本机；云端连接成功后同步，换电脑可恢复。请看左下角状态，遇到冲突先选择保留哪份。'}<br>完成记录来自你的产出说明或测验；不代表已经掌握全部知识。</div>`;
  }
  function modeContent() { return mode === 'quiz' ? quizPanel() : mode === 'review' ? reviewPanel() : chatPanel(); }
  function compactProgress() {
    const saved = snapshot(), all = stages(), completed = saved.completedStages || [], st = stageInfo(), wrong = learning()?.getReview(profileKey()) || [];
    return `<div class="coach-progress-label"><strong>${completed.length}<small> / ${all.length} 步已记录完成</small></strong><span>${Math.round(completed.length / all.length * 100)}%</span></div><div class="coach-path-progress" role="progressbar" aria-label="已记录完成的学习步骤" aria-valuenow="${completed.length}" aria-valuemin="0" aria-valuemax="${all.length}"><span style="width:${completed.length / all.length * 100}%"></span></div><ol class="coach-stage-list">${all.map((s,i) => `<li><button data-coach-action="stage" data-stage="${s.id}" class="${s.id === st.id ? 'is-current' : ''} ${completed.includes(s.id) ? 'is-complete' : ''}" ${s.id === st.id ? 'aria-current="step"' : ''}><span class="coach-stage-number">${completed.includes(s.id) ? '✓' : i + 1}</span><span>${escape(s.title)}<small>${completed.includes(s.id) ? '已记录完成' : s.id === st.id ? '当前这一步' : '待学习'}</small></span></button></li>`).join('')}</ol><div class="coach-score-grid"><div><span>完整测验最高</span><strong>${saved.quiz.bestScore == null ? '—' : saved.quiz.bestScore + '<small>分</small>'}</strong></div><div><span>待复习错题</span><button class="coach-score-link" data-coach-action="mode" data-mode="review">${wrong.length}<small>道 ↗</small></button></div></div><label class="check-row coach-include-context"><input type="checkbox" id="coach-context-toggle" ${includeContext ? 'checked' : ''}><span class="check-title">提问时带上目标、学习边界和当前节点</span></label><p class="coach-source-note">产出说明和实际测验用于记录进度；聊天、笔记和资料数量不算作掌握。</p>`;
  }
  function setContext(data) {
    const previous = scopeKey(); context = data || {};
    if (previous !== scopeKey()) { if (activeRequest) stopCurrent(true); feedback = ''; }
    session();
  }
  function renderEmbedded(data, options = {}) {
    setContext(data); embedded = true;
    focusedNodeIndex = Number.isInteger(options.nodeIndex) && options.nodeIndex >= 0 && options.nodeIndex < 6 ? options.nodeIndex : null;
    if (['chat','quiz','review'].includes(options.mode)) mode = options.mode;
    return `<section class="coach-embedded" id="coach-workbench" aria-label="当前 Wiki 学习环境"><div id="coach-connection">${connection()}</div><div class="coach-embedded-heading"><strong>${escape(focusedNode()?.name || context.profile || '我的学习环境')}</strong><button class="text-button" data-coach-action="new" ${sending() ? 'disabled' : ''}>＋ 新对话</button></div><div class="coach-mode-tabs" role="tablist" aria-label="学习方式">${[['chat','学习对话','☁'],['quiz','当前方向完整测验','✎'],['review','错题复习','↺']].map(([id,title,icon]) => `<button role="tab" id="coach-tab-${id}" aria-controls="coach-mode-content" aria-selected="${mode === id}" data-coach-action="mode" data-mode="${id}" class="${mode === id ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${title}</button>`).join('')}</div><div class="coach-notice" id="coach-notice" role="status" ${feedback ? '' : 'hidden'}>${escape(feedback)}</div><div class="coach-error" id="coach-error" role="alert" hidden></div><div id="coach-mode-content" role="tabpanel" aria-labelledby="coach-tab-${mode}">${modeContent()}</div><details class="coach-embedded-progress"><summary>十倍学习流程 · ${snapshot().completedStages.length} / ${stages().length} 步已记录完成</summary><div id="coach-progress">${compactProgress()}</div></details><p class="coach-method-caption">先定边界，再抓核心、分段练习、模拟测验、项目应用、费曼复述、速查复习；学习方法不保证“10 倍”效果。</p></section>`;
  }
  function render(data) {
    setContext(data); embedded = false; focusedNodeIndex = null;
    return `<section class="page-heading coach-page-heading"><div><div class="eyebrow">GROW AT YOUR OWN PACE</div><h1>和自己的 Codex，一点点学会 <span class="heading-flower">✿</span></h1><p class="heading-description">先定知识边界，再通过对话、练习和真实产出，把方法变成自己的。</p></div><button class="button secondary" data-coach-action="new" ${sending() ? 'disabled' : ''}>＋ 新对话</button></section><div id="coach-connection">${connection()}</div><div class="coach-layout coach-learning-layout" id="coach-workbench"><section class="coach-chat panel" aria-label="对话式学习与模拟测试"><div class="coach-mode-tabs" role="tablist" aria-label="学习方式">${[['chat','学习对话','☁'],['quiz','模拟测试','✎'],['review','错题复习','↺']].map(([id,title,icon]) => `<button role="tab" id="coach-tab-${id}" aria-controls="coach-mode-content" aria-selected="${mode === id}" data-coach-action="mode" data-mode="${id}" class="${mode === id ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${title}</button>`).join('')}</div><div class="coach-notice" id="coach-notice" role="status" ${feedback ? '' : 'hidden'}>${escape(feedback)}</div><div class="coach-error" id="coach-error" role="alert" hidden></div><div id="coach-mode-content" role="tabpanel" aria-labelledby="coach-tab-${mode}">${modeContent()}</div></section><aside class="coach-context coach-learning-progress panel" id="coach-progress" aria-label="我的学习进度">${sidebar()}</aside></div><p class="coach-method-caption">知识框架 → 抓住核心 → 分段练习 → 模拟测验 → 项目应用 → 费曼复述 → 速查复习。这里把方法变成可操作的步骤；练习题为本站整理，不是视频原题，也不承诺“10 倍”学习效果。</p>`;
  }
  function updateMessages() {
    const list = select('#coach-messages'); if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 150;
    list.innerHTML = messageList(); if (nearBottom) list.scrollTop = list.scrollHeight;
  }
  function updateForm() {
    const actions = select('.coach-compose-actions'); if (actions) actions.innerHTML = formActions();
    const fresh = select('[data-coach-action="new"]'); if (fresh) fresh.disabled = sending();
  }
  function refreshStudy() {
    const panel = select('#coach-progress'); if (panel) panel.innerHTML = embedded ? compactProgress() : sidebar();
    const progressSummary = select('.coach-embedded-progress > summary'); if (progressSummary) progressSummary.textContent = `十倍学习流程 · ${snapshot().completedStages.length} / ${stages().length} 步已记录完成`;
    const body = select('#coach-mode-content'); if (body) { body.innerHTML = modeContent(); body.setAttribute('aria-labelledby', `coach-tab-${mode}`); }
    document.querySelectorAll('.coach-mode-tabs [data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-selected', String(b.dataset.mode === mode)); });
    updateForm();
  }
  function notice(message) { feedback = message; const el = select('#coach-notice'); if (el) { el.textContent = message; el.hidden = !message; } }
  function error(message) { const el = select('#coach-error'); if (el) { el.textContent = message; el.hidden = false; } }
  async function request(path, body, signal, keepalive = false) { return fetch(path, {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Study-Token':token || ''},body:JSON.stringify(body),...(signal ? {signal} : {}),...(keepalive ? {keepalive:true} : {})}); }
  async function check() {
    if (checking || pageLeaving) return;
    checking = true; const panel = select('#coach-connection'); if (panel) panel.innerHTML = connection();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),25000);
    try {
      const r = await fetch('/api/codex/session', {credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (!r.ok) throw Error(local ? '请用“启动貅知识”打开支持 Codex 的本机版。' : '请先登录本站所有者的 OpenAI 账号，再检查连接。');
      const saved = await r.json(); if (typeof saved.token !== 'string') throw Error('Codex 连接没有就绪，请重新检查。'); token = saved.token;
      const health = await fetch('/api/codex/status', {credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (!health.ok) throw Error('Codex 暂时没有响应，稍后再检查连接。'); status = await health.json();
    } catch (e) { status = {available:false,authenticated:false,message:e.name === 'AbortError' ? '连接检查超时，请稍后重试。' : e.message}; }
    finally { clearTimeout(timeout); checking = false; const panel = select('#coach-connection'); if (panel) panel.innerHTML = connection(); updateForm(); }
  }
  async function send(text) {
    if (sending() || !sameScope(scope())) return;
    if (!status?.available || !status?.authenticated || (!local && !status?.ownerVerified)) { error('先检查连接，确认连接电脑的本人 Codex 已登录并运行。'); return; }
    text = text.trim(); if (!text) return;
    const target = scope(), chat = session(), controller = new AbortController();
    const task = {controller,chat,scope:target,stopRequested:false,jobId:null,toolResults:new Map()}; activeRequest = task;
    const err = select('#coach-error'); if (err) err.hidden = true;
    chat.draft = ''; const input = select('#coach-input'); if (input) input.value = '';
    chat.messages.push({role:'user',text},{role:'assistant',text:'',completed:false,nodeIndex:focusedNode() ? focusedNodeIndex : null,nodeTitle:focusedNode()?.name || ''}); const answer = chat.messages[chat.messages.length - 1];
    const promptContext = contextText(); saveSession(chat); updateMessages(); updateForm();
    let terminal = false;
    try {
      const r = await request('/api/codex/chat', {...target,message:text,context:promptContext,...(chat.conversationId ? {conversationId:chat.conversationId} : {})},controller.signal);
      if (task.stopRequested || !sameScope(target)) throw new DOMException('已离开这段对话。','AbortError');
      if (!r.ok) { let detail; try { detail = await r.json(); } catch {} throw Error(detail?.message || detail?.error || `Codex 暂时无法回答（${r.status}），请检查连接后重试。`); }
      if (!r.body) throw Error('浏览器没有收到回答数据，请重试。');
      const reader = r.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      async function handle(line) {
        if (task.stopRequested || !sameScope(target)) throw new DOMException('已离开这段对话。','AbortError');
        if (!line.trim()) return; const event = JSON.parse(line);
        if (event.type === 'job') {
          if(typeof event.jobId!=='string'||!event.jobId||event.roleId!==target.roleId||event.profileId!==target.profileId||(task.jobId&&event.jobId!==task.jobId))throw Error('收到不属于当前角色的任务，已停止。');
          task.jobId=event.jobId;
        }
        else if (event.type === 'conversation') {
          if(typeof event.conversationId!=='string'||!event.conversationId||(!local&&(typeof event.jobId!=='string'||!event.jobId)))throw Error('对话连接信息不完整，请重试。');
          if(task.jobId&&event.jobId!==task.jobId)throw Error('收到不属于当前请求的对话，已停止。');
          chat.conversationId = event.conversationId;task.jobId=event.jobId||null;
        }
        else if (event.type === 'tool_call') {
          const textId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
          if(!textId(event.callId)||!textId(event.nonce)||!task.jobId||event.jobId!==task.jobId||event.conversationId!==chat.conversationId||event.roleId!==target.roleId||event.profileId!==target.profileId)throw Error('收到其他角色或对话的操作，已拦截。');
          const callKey=`${event.callId}:${event.nonce}`;
          let result=task.toolResults.get(callKey);
          if(!result) {
            try {
              if(typeof window.StudyTools?.executeInline!=='function')throw Error('学习操作尚未加载，请刷新后重试');
              result=await window.StudyTools.executeInline(event.name,event.arguments,target,controller.signal);
            } catch(err) {result={ok:false,cloudSaved:false,message:err.message||'这次学习操作没有执行'};}
            if(task.stopRequested||activeRequest!==task||!sameScope(target))throw new DOMException('已离开这段对话。','AbortError');
            task.toolResults.set(callKey,result);
          }
          const posted=await request('/api/codex/tool-result',{jobId:task.jobId,...target,conversationId:chat.conversationId,callId:event.callId,nonce:event.nonce,result},controller.signal);
          if(!posted.ok)throw Error('学习操作结果未能送回 Codex，请检查同步状态后重试。');
          if(result.ok&&result.cloudSaved===true)notice('Codex 的学习修改已保存到当前角色的云端记录。');
          else if(!result.ok)error(result.message||'这次修改尚未保存到云端，Codex 已收到失败说明。');
        }
        else if (event.type === 'delta') { answer.text += event.text || ''; if (sameScope(target)) updateMessages(); }
        else if (event.type === 'done') terminal = true;
        else if (event.type === 'error') throw Error(event.message || '这次回答没有完成。');
      }
      while (true) { const {value,done} = await reader.read(); if (done) break; buffer += decoder.decode(value,{stream:true}); if(buffer.length>1000000)throw Error('回答数据过大，请缩小问题后重试。'); const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) await handle(line); }
      buffer += decoder.decode(); if (buffer.trim()) await handle(buffer);
      if (!terminal) throw Error('连接中断了，已收到的回答保留在上面。');
      if (!task.stopRequested && sameScope(target)) answer.completed = true;
    } catch (e) {
      if (e.name === 'AbortError' && task.stopRequested) { if (!answer.text) answer.text = '这次回答已停止。'; }
      else { answer.error = true; if (!answer.text) answer.text = '这次没有收到完整回答。'; if (sameScope(target)) error(e.message); }
    } finally { controller.abort(); if (activeRequest === task) activeRequest = null; saveSession(chat); if (sameScope(target)) { updateMessages(); updateForm(); } }
  }
  async function stopCurrent(detach = false) {
    const task = activeRequest; if (!task) return; task.stopRequested = true; task.controller.abort();
    if (detach) activeRequest = null;
    if (task.jobId || task.chat.conversationId) {
      try { const r = await request('/api/codex/cancel', {...task.scope,...(task.jobId?{jobId:task.jobId}:{conversationId:task.chat.conversationId})},null,detach); if (!r.ok) throw Error('停止请求未被确认，请检查连接状态。'); }
      catch (e) { if (!detach && sameScope(task.scope)) error(e.message); }
    }
  }
  function prefill(text) {
    mode = 'chat'; session().draft = text.slice(0,8000); saveSession(session()); refreshStudy();
    const input = select('#coach-input'); if (input) { input.focus(); input.setSelectionRange(input.value.length,input.value.length); }
    notice('问题已填好，确认后点击发送；不会自动替你发送。');
  }
  document.addEventListener('submit',e => {
    if (e.target.id?.startsWith('coach-') && !sameScope(scope())) { e.preventDefault(); return; }
    if (e.target.id === 'coach-form') { e.preventDefault(); send(select('#coach-input').value); }
    else if (e.target.id === 'coach-evidence-form') {
      e.preventDefault(); const value = select('#coach-evidence').value.trim(), st = stageInfo();
      if (!value) { error('先写一条自己的产出或复述，再记录这一步。'); select('#coach-evidence').focus(); return; }
      if (!learning()) { error('学习记录暂时未就绪，请刷新后重试。'); return; }
      try { learning().completeStage(profileKey(),st.id,value); evidenceDrafts.delete(`${scopeKey()}:${st.id}`); refreshStudy(); notice(`已保存“${st.title}”的产出记录。下一步可以选择新的学习阶段。`); }
      catch (err) { error(err.message || '这一步暂时无法保存，请重试。'); }
    } else if (e.target.id === 'coach-quiz-form') {
      e.preventDefault(); const chosen = e.target.querySelector('input[name="coach-answer"]:checked'); if (!chosen || !learning()) return;
      try { learning().grade(profileKey(), e.target.dataset.questionId, Number(chosen.value)); refreshStudy(); } catch (err) { error(err.message || '这道题暂时无法提交，请重试。'); }
    }
  });
  document.addEventListener('keydown',e => { if (e.target.id === 'coach-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.target.value); } });
  document.addEventListener('input',e => {
    if (!sameScope(scope())) return;
    if (e.target.id === 'coach-input') { session().draft = e.target.value; saveSession(session()); }
    if (e.target.id === 'coach-evidence') evidenceDrafts.set(`${scopeKey()}:${stageInfo().id}`,e.target.value);
  });
  document.addEventListener('change',e => {
    if (!sameScope(scope())) return;
    if (e.target.id === 'coach-context-toggle') includeContext = e.target.checked;
    if (e.target.name === 'coach-answer') { const q = learning()?.getQuiz(profileKey()), form = select('#coach-quiz-form'); if (q && form) choices.set(`${scopeKey()}:${q.id}:${form.dataset.questionId}`,Number(e.target.value)); const button = select('#coach-quiz-submit'); if (button) button.disabled = false; }
  });
  document.addEventListener('click',async e => {
    const b = e.target.closest('[data-coach-action]'); if (!b || b.disabled) return; const action = b.dataset.coachAction;
    if (!sameScope(scope())) return;
    if (action === 'retry') check();
    else if (action === 'mode') { mode = b.dataset.mode; feedback = ''; notice(''); refreshStudy(); }
    else if (action === 'stage') { learning()?.setStage(profileKey(),b.dataset.stage); mode = 'chat'; notice(''); refreshStudy(); }
    else if (action === 'stage-prompt') prefill(promptFor(stageInfo().id));
    else if (action === 'question-start') prefill(`针对“${focusedNode()?.name || context.goal || '我的学习目标'}”，请先问我一个能判断学习起点的问题，先不要讲答案。`);
    else if (action === 'save-answer') {
      const target = scope(), index = Number(b.dataset.messageIndex), message = Number.isInteger(index) ? session().messages[index] : null;
      if (sending() || !message || message.role !== 'assistant' || !message.completed || message.error || !message.text) return;
      if (typeof window.StudyApp?.addMaterial !== 'function') { error('资料库暂时没有就绪，请刷新后再保存。'); return; }
      b.disabled = true;
      try {
        const result = window.StudyApp.addMaterial({title:((message.nodeTitle || context.profile || '我的学习') + ' · 对话摘录').slice(0,160),type:'note',content:message.text.slice(0,10000),url:'',nodeIndex:message.nodeIndex},target);
        if (result?.ok === false) throw Error(result.message || '资料暂时未能保存，请重试。');
        if (sameScope(target)) notice('已沉淀到当前角色、当前方向的资料库；可在资料面板查看。记录资料不算作掌握。');
      } catch (err) { if (sameScope(target)) { error(err.message || '资料暂时未能保存，请重试。'); b.disabled = false; } }
    }
    else if (action === 'copy-prompt') {
      const target = scope();
      const text = session().draft.trim(); if (!text) { notice('先写一个问题，或点击“填入这一步的提问”。'); return; }
      try { await navigator.clipboard.writeText(text); if (sameScope(target)) notice('已复制，可以粘贴到你自己的官方 Codex 对话。'); }
      catch { if (!sameScope(target)) return; const input = select('#coach-input'); if (input) { input.focus(); input.select(); } notice('浏览器未允许自动复制，已选中问题，请手动复制。'); }
    } else if (action === 'new' && !sending()) { const chat = session(); chat.messages = []; chat.conversationId = null; chat.draft = ''; saveSession(chat); const err = select('#coach-error'); if (err) err.hidden = true; refreshStudy(); notice('新对话已开始；已记录的学习进度与测验成绩继续保留。'); }
    else if (action === 'stop') { b.disabled = true; b.textContent = '正在停止…'; stopCurrent(); }
    else if (action === 'quiz-start' || action === 'review-start') {
      if (!learning()) return; positions.set(scopeKey(),0); mode = 'quiz';
      try { if (action === 'review-start') learning().startReview(profileKey()); else learning().startQuiz(profileKey()); refreshStudy(); notice('新一轮已开始。先自己作答，再看解释。'); } catch (err) { error(err.message || '暂时无法开始测验，请重试。'); }
    } else if (action === 'quiz-next' || action === 'quiz-back') { positions.set(scopeKey(),Math.max(0,(positions.get(scopeKey()) || 0) + (action === 'quiz-next' ? 1 : -1))); refreshStudy(); }
    else if (action === 'quiz-finish') { const result = learning()?.finishQuiz(profileKey()); if (!result?.completed) { error('还有未提交的题目，完成全部作答后再查看成绩。'); return; } refreshStudy(); notice('本轮成绩已按实际提交记录。'); }
  });
  window.addEventListener('study-learning-change', e => { if (!e.detail?.profile || e.detail.profile === profileKey()) refreshStudy(); });
  window.addEventListener('study-app-change', () => { if (activeRequest && !sameScope(activeRequest.scope)) stopCurrent(true); });
  window.addEventListener('study-role-leaving', () => { stopCurrent(true); });
  window.addEventListener('pagehide', () => { pageLeaving = true; stopCurrent(true); });
  window.addEventListener('pageshow', () => { pageLeaving = false; updateMessages(); updateForm(); });
  window.studyCoach = {render,renderEmbedded,mount() { updateMessages(); if (!status && !checking) check(); },getContextText:contextText,prepare(text,target) {
    const current=window.StudyApp?.getContext?.();
    if(!current||pageLeaving||window.StudyRole?.isSwitching?.()||scopeKey(target)!==scopeKey(current)||sending())return false;
    if(document.getElementById('study-wiki')&&typeof window.StudyWiki?.openPane==='function'&&(!embedded||!select('#coach-input'))) {
      if(window.StudyWiki.openPane('chat')===false)return false;
    }
    const latest=window.StudyApp?.getContext?.();
    if(!latest||pageLeaving||window.StudyRole?.isSwitching?.()||scopeKey(target)!==scopeKey(latest)||sending())return false;
    context=latest;prefill(text);if (!embedded) location.hash='coach';return true;
  }};
})();
