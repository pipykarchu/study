/* 练习参考题：按知芽当前学习骨架编写，并非视频原题，也不是能力证书。
 * 本地进度只记录显式学习动作与答题证据，不会因为 AI 回复自动增加。
 */
(function (global) {
  'use strict';
  const KEY = 'study-bloom-learning-v2';
  const PROFILE_IDS = ['product', 'coding', 'custom'];
  const DAY = 86400000;
  const MAX_TIME = 8640000000000000 - 3 * DAY;
  const LIMIT = 100;
  const stages = [
    {id: 'frame', title: '知识框架与边界', description: '明确用途、成果、必学与暂不学，先画出知识地图。'},
    {id: 'core', title: '只抓核心', description: '挑出最常用的概念，用一个例子说明它们的关系。'},
    {id: 'learn', title: '分段练习', description: '一次只练一个小任务，留下自己的做法和纠错记录。'},
    {id: 'quiz', title: '主动回忆测验', description: '先自己作答再看解析；完整覆盖六个节点、达到 80% 记为通过。'},
    {id: 'project', title: '项目应用', description: '把知识用到真实小作品，按事先写好的标准验收。'},
    {id: 'feynman', title: '费曼复述', description: '不用照抄，用自己的话解释原理、例子和适用边界。'},
    {id: 'review', title: '速查与复习', description: '整理速查表，隔一段时间再回忆错题和关键概念。'}
  ].map(Object.freeze);
  Object.freeze(stages);
  const STAGE_IDS = stages.map(s => s.id);
  const Q = (nodeIndex, prompt, options, correctIndex, explanation) => ({nodeIndex, prompt, options, correctIndex, explanation});
  const bank = {
    product: [
      Q(0, '准备做 AI 学习助手时，哪项最适合先写进问题定义？', ['先选一个最新的大模型', '谁在什么场景遇到什么困难，以及如何判断改善', '先加入所有可能用到的功能'], 1, '先明确用户、场景、问题和成功标准，才有依据选择模型与功能。'),
      Q(0, '把“提升学习体验”变成可检验的目标，哪项最合适？', ['界面看起来很智能', '所有用户都觉得很好', '让目标用户在 10 分钟内独立完成知识框架，并记录完成率'], 2, '目标要说明对象、任务和可观察的结果；“很智能”无法直接验收。'),
      Q(1, '模型给出语气肯定的事实回答，最合理的下一步是？', ['检查关键结论的来源，必要时人工复核', '语气肯定说明无需核查', '把同一回答重复展示三次'], 0, '模型可能生成看似可信但不准确的内容。关键事实需要核对来源，不能由语气判断真实性。'),
      Q(1, '要求模型输出 JSON，主要能改善什么？', ['保证每个事实正确', '让输出更便于程序解析，同时仍需校验字段与内容', '让所有请求都不可能失败'], 1, '结构化输出便于程序处理，但格式、取值和事实仍需校验。'),
      Q(2, '哪种提示词最有利于形成可复用的工作流？', ['帮我做得好一点', '你自由发挥，输出什么都行', '说明任务、输入、输出格式、约束和检查标准'], 2, '稳定流程需要清楚的输入、步骤、输出和检查点；模糊要求不便复现和评测。'),
      Q(2, '一个提示词在单个例子上成功后，应该怎样验证？', ['用不同输入和边界情况测试，记录失败并修改', '直接认定所有场景都成功', '只把成功回答截图保存'], 0, '单个例子只能证明该例可行；多样输入与边界案例能暴露不稳定的地方。'),
      Q(3, 'RAG 流程最核心的顺序是什么？', ['直接把问题当成答案', '检索相关资料，再让模型基于资料回答并给出依据', '先编造引用，再搜索相同文字'], 1, 'RAG 用检索得到的资料为回答提供上下文；应能追溯引用，并处理资料不足的情况。'),
      Q(3, '知识库没有支持答案的资料时，助手应该怎样做？', ['拼出一个看起来合理的答案', '把不相关资料列为证据', '说明资料不足，提出需要补充的信息或转人工核查'], 2, '资料不足应明确说明，避免将猜测包装为有依据的回答。'),
      Q(4, '哪组材料更适合检验 AI 学习助手原型？', ['包含正常、错误与无答案情况，并写好期望结果的案例', '只有产品宣传文案', '只挑一个成功演示的案例'], 0, '带期望结果的多类型案例能检验关键流程、异常处理与可靠性。'),
      Q(4, '报告“10 条评测中 8 条达到预设标准”时，还应记录什么？', ['只写 80% 并宣称全部能力已掌握', '失败案例、具体错因、测试范围与下一步修正', '隐藏失败的两条'], 1, '成功率必须和测试范围及错误一起看。小样本评测不能代表所有场景或实际掌握程度。'),
      Q(5, '向面试官介绍项目，哪种表达最能展示个人贡献？', ['只说用了哪些热门工具', '把全部成果归因于 AI', '说明问题、方案、取舍、结果，以及自己负责和验证的部分'], 2, '项目表达要让人看见你的判断、行动与证据，工具清单本身不能解释贡献。'),
      Q(5, '一次项目复盘中，哪项最可执行？', ['记录一个具体失败、分析原因，约定下次修改和验证办法', '以后都要更加努力', '从不记录限制或错误'], 0, '有效复盘把可观察的问题连接到改进行动与验证标准，而不是泛泛评价。')
    ],
    coding: [
      Q(0, '让 AI 开始做一个小网站前，最该先讲清什么？', ['用户要完成的任务、最短流程和完成条件', '先安装尽可能多的框架', '把所有页面都加动画'], 0, '明确用户任务和完成条件能约束范围，也能为后续检查提供标准。'),
      Q(0, '设计首版待办网站时，哪项最适合放进“暂不做”？', ['能新增和完成待办', '全球多人协作和复杂计费系统', '错误输入给出提醒'], 1, '首版先完成核心任务。没有当前使用需求的复杂功能应留在后续范围中。'),
      Q(1, 'HTML、CSS、JavaScript 通常各负责什么？', ['HTML 行为，CSS 数据库，JS 排版', '三者都只负责文字颜色', 'HTML 结构，CSS 外观，JS 交互行为'], 2, 'HTML 描述内容与结构，CSS 控制呈现，JavaScript 处理交互与逻辑。'),
      Q(1, '需要让点击按钮后出现提示，通常应修改哪里？', ['JavaScript 事件处理', '只修改页面标题', '只调整图片尺寸'], 0, '按钮点击属于交互行为，通常由事件监听与相应 JavaScript 逻辑处理。'),
      Q(2, '哪种发给 AI 的修改任务最容易检查？', ['把整个项目全部重写，越多越好', '只修复空输入可提交的问题，说明提示文字，并保持其他流程', '随便做得高级一些'], 1, '一个范围清楚、带输入输出和约束的小任务，更容易审查差异和验证结果。'),
      Q(2, 'AI 给出代码修改后，最合理的动作是？', ['因为没有报错文字就跳过检查', '直接覆盖所有旧版本', '阅读关键差异，并实际走一次对应用户流程'], 2, '代码看起来合理仍可能有行为问题；差异审查和实际操作能验证修改是否符合要求。'),
      Q(3, '只在浏览器保存学习笔记，最准确的描述是？', ['一般只在该浏览器环境可用，不会自动跨电脑同步', '所有设备天然同步', '任何人都能读取所有浏览器的数据'], 0, 'localStorage 属于当前站点和浏览器环境；跨设备同步需要另外的服务或导入导出。'),
      Q(3, '表单收到空白或不符合要求的内容时，应该怎样做？', ['无条件保存并显示成功', '明确指出问题、保留可修正输入，再由用户提交', '刷新后把所有信息清空'], 1, '输入校验与可理解的反馈能帮助用户修正问题，避免把无效输入当作成功。'),
      Q(4, '网站发布后，哪项最能检验用户是否真的可用？', ['只看编辑器里没有红线', '只检查首页截图', '打开发布链接，检查手机布局、控制台和完整核心流程'], 2, '发布可访问并不等于流程可用；要在实际页面检查交互、显示与错误。'),
      Q(4, '网页突然按钮无反应，合理的排查起点是？', ['稳定复现操作，查看控制台和相关事件处理', '随机删除文件直到有变化', '把所有依赖都换掉'], 0, '先复现并收集错误，再定位相关逻辑，能减少盲目修改。'),
      Q(5, '一个小网站的 README 最应包含哪组信息？', ['只放一句“这是最棒的网站”', '用途、启动方式、关键用法和已知限制', '账号密码与访问令牌'], 1, 'README 应帮助别人运行和理解项目；凭据不应写入说明或代码仓库。'),
      Q(5, '下一轮迭代应该优先选择什么？', ['每次换一个新框架', '给所有区域加动效', '依据真实失败记录，选择影响核心任务且能验证的改进'], 2, '迭代应服务于用户任务，并能通过明确检查判断改进是否有效。')
    ],
    custom: [
      Q(0, '开始学一个新主题，哪种目标最清楚？', ['尽可能学完一切', '说出实际用途、目标水平，并规定一个可演示成果', '先收藏一百份资料'], 1, '可观察的用途、水平和成果能帮助确定边界，避免无目的地积累资料。'),
      Q(0, '遇到与当前成果无关的高阶内容，应该怎样处理？', ['立刻抛开原目标深挖', '认定永远没有价值', '记录到暂不学清单，当前先完成目标需要的部分'], 2, '暂不学习是范围管理。保留线索，待应用场景出现后再决定是否深入。'),
      Q(1, '知识框架最有用的内容是什么？', ['核心概念及其关系、顺序和适用边界', '只是一长串没有关系的名词', '把资料全部原样复制'], 0, '框架帮助理解知识如何连接，并指明先后依赖和边界，而不只是收集词语。'),
      Q(1, '怎样检查自己是否理解了核心概念？', ['只要看过就算懂', '合上资料，用自己的话说明，并举例和反例', '把原文朗读一次'], 1, '不依赖原文的解释和例子能暴露理解缺口；熟悉原文不等于能独立运用。'),
      Q(2, '最小练习最好怎样设计？', ['一次覆盖主题所有高阶难点', '只看老师完成，不自己尝试', '围绕一个核心概念，做一个能验收的小任务'], 2, '小任务能把概念立即用于实践，也便于得到及时反馈和定位错误。'),
      Q(2, '照着教程做完后，下一步最能检验学习效果的是？', ['不看步骤，换一个相近例子独立完成', '只给教程点赞', '复制同一结果并称为迁移'], 0, '换例子独立完成能检验是否理解和会用，而不是只记住操作位置。'),
      Q(3, '主动回忆测验最合适的顺序是？', ['先看答案再声称自己答对', '先独立作答，再对照解释并记录错因', '只重复读同一句话'], 1, '先回忆再反馈能提供真实的理解证据，提前看答案会掩盖缺口。'),
      Q(3, '答错一道题后，怎样更有助于纠错？', ['只记住选项字母', '删除错题不再看', '解释为什么错，修正理解，再隔一段时间换例子重试'], 2, '纠错要处理原因并用延迟或新例子检验，记住字母不代表理解。'),
      Q(4, '学习小项目应该优先来自哪里？', ['与自己的实际用途相关、范围可控的问题', '完全无关但看起来很复杂的问题', '只复制一份无法运行的作品'], 0, '真实用途能提供意义与验收标准，范围可控则有利于完成和获得反馈。'),
      Q(4, '判断作品是否达到目标，最合理的依据是？', ['做了很长时间', '事先写好的完成标准与实际演示结果', '使用的工具数量'], 1, '完成标准连接学习目标与实际结果；时间和工具数量只能描述投入。'),
      Q(5, '一页速查表最适合放什么？', ['全部资料逐字复制', '只放励志标语', '高频概念、关键步骤、常见错误和资料入口'], 2, '速查表应便于在实际任务中快速查找，覆盖常用内容和易错点。'),
      Q(5, '费曼复述时发现自己只能复读术语，应该怎么办？', ['回到不清楚的部分，补一个日常例子，再尝试简明解释', '增加更多术语掩盖不清楚', '立即认定主题已经全部掌握'], 0, '讲不清楚是定位理解缺口的信号。补例子、再解释能帮助形成自己的理解。')
    ]
  };
  PROFILE_IDS.forEach(profile => bank[profile].forEach((q, i) => {q.id = profile + '-q' + (i + 1); Object.freeze(q.options); Object.freeze(q);}));
  const clone = value => JSON.parse(JSON.stringify(value));
  const profileId = profile => {if (!PROFILE_IDS.includes(profile)) throw new Error('未知学习方向'); return profile;};
  const stageId = stage => {if (!STAGE_IDS.includes(stage)) throw new Error('未知学习阶段'); return stage;};
  const fresh = () => ({stage: 'frame', completedStages: [], quiz: {attempts: [], active: null}, recentEvidence: []});
  const empty = () => ({version: 2, profiles: {product: fresh(), coding: fresh(), custom: fresh()}});
  let data = empty();
  let storage = {available: true, warning: ''};
  const question = (profile, id) => bank[profile].find(q => q.id === id);
  const publicQuestion = q => ({id: q.id, questionId: q.id, nodeIndex: q.nodeIndex, prompt: q.prompt, options: [...q.options]});
  const finiteInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const fail = () => {throw new Error('学习备份格式无效，未导入任何内容');};
  function checkObject(value, allowed) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') fail();
    if (Object.keys(value).some(key => !allowed.includes(key))) fail();
    return value;
  }
  function safeTree(value, depth = 0, budget = {n: 0}) {
    if (depth > 15 || ++budget.n > 20000) fail();
    if (typeof value === 'number' && !Number.isFinite(value)) fail();
    if (value && typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail();
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail();
        safeTree(value[key], depth + 1, budget);
      }
    } else if (!['string', 'number', 'boolean', 'undefined'].includes(typeof value) && value !== null) fail();
  }
  function validAttempt(raw, profile, finished) {
    checkObject(raw, ['id', 'kind', 'startedAt', 'finishedAt', 'questionIds', 'answers']);
    if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id) || !['quiz', 'review'].includes(raw.kind)) fail();
    if (!finiteInt(raw.startedAt, 0, MAX_TIME) || (raw.finishedAt !== null && !finiteInt(raw.finishedAt, raw.startedAt, MAX_TIME))) fail();
    if (finished && raw.finishedAt === null) fail();
    if (!Array.isArray(raw.questionIds) || raw.questionIds.length < 1 || raw.questionIds.length > 12 || new Set(raw.questionIds).size !== raw.questionIds.length || raw.questionIds.some(id => !question(profile, id))) fail();
    if (!Array.isArray(raw.answers) || raw.answers.length > raw.questionIds.length) fail();
    const seen = new Set();
    const answers = raw.answers.map(a => {
      checkObject(a, ['questionId', 'choiceIndex', 'answeredAt']);
      const q = question(profile, a.questionId);
      if (!q || !raw.questionIds.includes(a.questionId) || seen.has(a.questionId) || !finiteInt(a.choiceIndex, 0, q.options.length - 1) || !finiteInt(a.answeredAt, raw.startedAt, MAX_TIME) || (raw.finishedAt !== null && a.answeredAt > raw.finishedAt)) fail();
      seen.add(a.questionId);
      return {questionId: a.questionId, choiceIndex: a.choiceIndex, answeredAt: a.answeredAt};
    });
    if (raw.finishedAt !== null && answers.length !== raw.questionIds.length) fail();
    return {id: raw.id, kind: raw.kind, startedAt: raw.startedAt, finishedAt: raw.finishedAt, questionIds: [...raw.questionIds], answers};
  }
  function resultFor(profile, attempt) {
    const answered = attempt.answers.length, total = attempt.questionIds.length;
    const correct = attempt.answers.filter(a => question(profile, a.questionId).correctIndex === a.choiceIndex).length;
    const completed = answered === total;
    const score = answered ? Math.round(correct / total * 100) : null;
    const weakNodes = [...new Set(attempt.answers.filter(a => question(profile, a.questionId).correctIndex !== a.choiceIndex).map(a => question(profile, a.questionId).nodeIndex))];
    return {id: attempt.id, kind: attempt.kind, completed, fullCoverage: coversCourse(profile, attempt), answered, total, correct, score, weakNodes, passed: completed && score >= 80, dueAt: attempt.finishedAt === null ? null : attempt.finishedAt + (score >= 80 ? 3 : 1) * DAY};
  }
  function coversCourse(profile, attempt) {return attempt.kind === 'quiz' && new Set(attempt.questionIds.map(id => question(profile, id).nodeIndex)).size === 6;}
  function validate(raw) {
    safeTree(raw);
    checkObject(raw, ['version', 'profiles']);
    if (raw.version !== 2) fail();
    checkObject(raw.profiles, PROFILE_IDS);
    const clean = empty();
    for (const profile of PROFILE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(raw.profiles, profile)) fail();
      const p = checkObject(raw.profiles[profile], ['stage', 'completedStages', 'quiz', 'recentEvidence']);
      if (!STAGE_IDS.includes(p.stage) || !Array.isArray(p.completedStages) || p.completedStages.length > 7 || new Set(p.completedStages).size !== p.completedStages.length || p.completedStages.some(id => !STAGE_IDS.includes(id))) fail();
      const quiz = checkObject(p.quiz, ['attempts', 'active']);
      if (!Array.isArray(quiz.attempts) || quiz.attempts.length > LIMIT) fail();
      const attempts = quiz.attempts.map(a => validAttempt(a, profile, true));
      if (new Set(attempts.map(a => a.id)).size !== attempts.length) fail();
      const active = quiz.active === null ? null : validAttempt(quiz.active, profile, false);
      if (active && active.finishedAt !== null && !attempts.some(a => JSON.stringify(a) === JSON.stringify(active))) fail();
      if (active && active.finishedAt === null && attempts.some(a => a.id === active.id)) fail();
      if (!Array.isArray(p.recentEvidence) || p.recentEvidence.length > LIMIT) fail();
      const recentEvidence = p.recentEvidence.map(e => {
        checkObject(e, ['stage', 'text', 'at', 'source']);
        if (!STAGE_IDS.includes(e.stage) || typeof e.text !== 'string' || !e.text.trim() || e.text.length > 2000 || !finiteInt(e.at, 0, MAX_TIME) || !['user', 'quiz'].includes(e.source)) fail();
        return {stage: e.stage, text: e.text, at: e.at, source: e.source};
      });
      const completedStages = [...p.completedStages];
      if (completedStages.includes('quiz') && !attempts.some(a => coversCourse(profile, a) && resultFor(profile, a).passed)) fail();
      clean.profiles[profile] = {stage: p.stage, completedStages, quiz: {attempts, active}, recentEvidence};
    }
    return clean;
  }
  function save(profile) {
    try {global.localStorage.setItem(KEY, JSON.stringify(data)); storage = {available: true, warning: ''};}
    catch (_) {storage = {available: false, warning: '本浏览器无法保存学习记录，请及时导出备份。'};}
    global.dispatchEvent(new global.CustomEvent('study-learning-change', {detail: {profile}}));
  }
  try {
    const raw = global.localStorage.getItem(KEY);
    if (raw) {
      if (raw.length > 1000000) fail();
      data = validate(JSON.parse(raw));
    }
  } catch (_) {storage = {available: false, warning: '学习记录暂时无法读取，请检查浏览器存储或导入有效备份。'};}
  function state(profile) {return data.profiles[profileId(profile)];}
  function answerResult(profile, a) {
    const q = question(profile, a.questionId);
    return {questionId: q.id, choiceIndex: a.choiceIndex, answeredAt: a.answeredAt, correct: q.correctIndex === a.choiceIndex, explanation: q.explanation, correctIndex: q.correctIndex, nodeIndex: q.nodeIndex};
  }
  function activeView(profile, a) {
    if (!a) return null;
    return Object.assign(resultFor(profile, a), {questions: a.questionIds.map(id => publicQuestion(question(profile, id))), answers: a.answers.map(answer => answerResult(profile, answer)), finished: a.finishedAt !== null, startedAt: a.startedAt, finishedAt: a.finishedAt});
  }
  function get(profile) {
    const p = state(profile);
    const attempts = p.quiz.attempts.map(a => Object.assign(resultFor(profile, a), {startedAt: a.startedAt, finishedAt: a.finishedAt}));
    const last = attempts[attempts.length - 1];
    const fullAttempts = attempts.filter(a => a.fullCoverage);
    const lastFull = fullAttempts[fullAttempts.length - 1];
    const active = activeView(profile, p.quiz.active);
    return clone({stage: p.stage, completedStages: p.completedStages, quiz: {attempts, bestScore: fullAttempts.length ? Math.max(...fullAttempts.map(a => a.score)) : null, lastScore: lastFull ? lastFull.score : null, answered: active ? active.answered : (last ? last.answered : 0), total: active ? active.total : (last ? last.total : 0), dueAt: last ? last.dueAt : null, active}, recentEvidence: p.recentEvidence});
  }
  function evidence(p, stage, text, source) {
    p.recentEvidence.push({stage, text, at: Date.now(), source});
    p.recentEvidence = p.recentEvidence.slice(-LIMIT);
    if (!p.completedStages.includes(stage)) p.completedStages.push(stage);
  }
  function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]];}
    return out;
  }
  function begin(profile, ids, kind) {
    const p = state(profile);
    p.stage = 'quiz';
    p.quiz.active = {id: 'a-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), kind, startedAt: Date.now(), finishedAt: null, questionIds: ids, answers: []};
    save(profile);
    return ids.map(id => publicQuestion(question(profile, id)));
  }
  function getReview(profile) {
    const p = state(profile), latest = new Map();
    const rounds = [...p.quiz.attempts];
    if (p.quiz.active && p.quiz.active.finishedAt === null) rounds.push(p.quiz.active);
    for (const round of rounds) for (const a of round.answers) latest.set(a.questionId, a);
    return Array.from(latest.values()).filter(a => question(profile, a.questionId).correctIndex !== a.choiceIndex).map(a => Object.assign(publicQuestion(question(profile, a.questionId)), {lastChoice: a.choiceIndex, explanation: question(profile, a.questionId).explanation, correctIndex: question(profile, a.questionId).correctIndex}));
  }
  global.StudyLearning = Object.freeze({
    stages,
    get,
    getStorageStatus: () => clone(storage),
    setStage(profile, stage) {const p = state(profile); p.stage = stageId(stage); save(profile); return get(profile);},
    completeStage(profile, stage, text) {
      const p = state(profile); stageId(stage);
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('请留下 1 至 2000 字的学习证据');
      if (stage === 'quiz' && !p.quiz.attempts.some(a => coversCourse(profile, a) && resultFor(profile, a).passed)) throw new Error('请先完成覆盖六个节点的测验，达到 80% 后记录通过');
      evidence(p, stage, text.trim(), 'user'); save(profile); return get(profile);
    },
    getQuestions(profile) {profileId(profile); return bank[profile].map(publicQuestion);},
    startQuiz(profile, count = 6) {
      profileId(profile);
      if (!finiteInt(count, 1, 12)) throw new Error('测验题数应为 1 至 12');
      const first = [], second = [];
      for (let node = 0; node < 6; node++) {const pair = shuffle(bank[profile].filter(q => q.nodeIndex === node)); first.push(pair[0]); second.push(pair[1]);}
      return begin(profile, [...shuffle(first), ...shuffle(second)].slice(0, count).map(q => q.id), 'quiz');
    },
    startReview(profile) {
      const ids = getReview(profile).map(q => q.id);
      if (!ids.length) return [];
      return begin(profile, shuffle(ids), 'review');
    },
    getQuiz(profile) {return clone(activeView(profile, state(profile).quiz.active));},
    grade(profile, questionId, choiceIndex) {
      const p = state(profile), a = p.quiz.active, q = question(profile, questionId);
      if (!a || !q || !a.questionIds.includes(questionId)) throw new Error('请先开始测验并回答本轮题目');
      if (!finiteInt(choiceIndex, 0, q.options.length - 1)) throw new Error('请选择有效选项');
      const previous = a.answers.find(item => item.questionId === questionId);
      if (previous) return Object.assign(resultFor(profile, a), answerResult(profile, previous), {duplicate: true});
      if (a.finishedAt !== null) throw new Error('本轮测验已结束，请重新开始');
      const answer = {questionId, choiceIndex, answeredAt: Date.now()};
      a.answers.push(answer); save(profile);
      return Object.assign(resultFor(profile, a), answerResult(profile, answer), {duplicate: false});
    },
    finishQuiz(profile) {
      const p = state(profile), a = p.quiz.active;
      if (!a) return {completed: false, score: null, correct: 0, answered: 0, total: 0, weakNodes: [], dueAt: null, passed: false};
      if (a.answers.length !== a.questionIds.length) return Object.assign(resultFor(profile, a), {completed: false, score: null, passed: false, dueAt: null});
      if (a.finishedAt !== null) return clone(resultFor(profile, a));
      a.finishedAt = Date.now();
      const result = resultFor(profile, a);
      p.quiz.attempts.push(clone(a));
      const proof = p.quiz.attempts.find(attempt => coversCourse(profile, attempt) && resultFor(profile, attempt).passed);
      p.quiz.attempts = p.quiz.attempts.slice(-LIMIT);
      if (proof && !p.quiz.attempts.some(attempt => coversCourse(profile, attempt) && resultFor(profile, attempt).passed)) p.quiz.attempts[0] = proof;
      if (result.passed && coversCourse(profile, a)) evidence(p, 'quiz', '完成 ' + result.total + ' 道参考题，答对 ' + result.correct + ' 道（' + result.score + '%）；仅表示本次测验通过。', 'quiz');
      save(profile); return clone(result);
    },
    getReview,
    reset(profile) {data.profiles[profileId(profile)] = fresh(); save(profile); return get(profile);},
    exportData() {return clone(data);},
    validateData(raw) {return validate(raw);},
    importData(raw) {
      if (typeof raw === 'string') {if (raw.length > 1000000) fail(); try {raw = JSON.parse(raw);} catch (_) {fail();}}
      const clean = validate(raw); data = clean; save(null); return true;
    }
  });
})(window);
