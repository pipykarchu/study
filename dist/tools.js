'use strict';
(() => {
  const shared = new Map((window.StudyToolDefinitions || []).map(def => [def.name,def]));
  const withoutScope = ({roleId,profileId,...values}) => values;
  let controller = null, registered = false, pendingWrite=Promise.resolve(), lifecycle=0, hidden=false;
  let toolState = {available:false,registered:0,message:'请在 Codex 内置浏览器使用站点工具'};
  function publishStatus() {
    const box = document.getElementById('study-tools-status');
    if(box){box.textContent=toolState.message;box.title=toolState.available?'在地址栏的“站点工具”中查看。回答在 Codex 对话里进行，网页展示学习记录。':'请使用支持站点工具的桌面版本，并在设置中允许站点工具。普通浏览器仍可学习和测验。';}
  }
  function valid(value,rule) {
    if(rule.type==='object') {
      if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))throw Error('工具参数应是有效对象');
      if(Object.keys(value).some(k=>!Object.hasOwn(rule.properties,k))||(rule.required||[]).some(k=>!Object.hasOwn(value,k)))throw Error('工具参数缺失或包含未知字段');
      for(const k of Object.keys(value))valid(value[k],rule.properties[k]);
    } else if(rule.type==='string') {
      if(typeof value!=='string'||!value.trim()||value.length<rule.minLength||value.length>rule.maxLength)throw Error('文字长度无效');
    } else if(rule.type==='integer') {
      if(!Number.isInteger(value)||value<rule.minimum||value>rule.maximum)throw Error('数字超出允许范围');
    } else if(rule.type==='array') {
      if(!Array.isArray(value)||value.length>rule.maxItems||(rule.minItems!==undefined&&value.length<rule.minItems))throw Error('清单条目数量有误');
      value.forEach(v=>valid(v,rule.items));
    }
    if(rule.enum&&!rule.enum.includes(value))throw Error('请选择有效选项');
  }
  const profile = () => window.StudyApp.getContext().profileId;
  function context() {
    const c=window.StudyApp.getContext(),p=window.StudyLearning.get(c.profileId);
    c.nodes=c.nodes.map(n=>({...n,note:n.note.slice(0,2000)}));
    return {...c,progress:{stage:p.stage,completedStages:p.completedStages,bestScore:p.quiz.bestScore,lastScore:p.quiz.lastScore,wrongCount:window.StudyLearning.getReview(c.profileId).length,recentEvidence:p.recentEvidence.slice(-5)},quiz:window.StudyLearning.getQuiz(c.profileId),sync:window.StudySync?.status()||{state:'loading'}};
  }
  const defs = [
    {...shared.get('study_get_context'),read:true,run:context},
    {...shared.get('study_select_profile'),run:i=>window.StudyApp.selectProfile(i.profileId)},
    {...shared.get('study_update_goal'),run:i=>{window.StudyApp.updateGoal(withoutScope(i));return context();}},
    {...shared.get('study_apply_framework'),run:i=>window.StudyApp.applyFramework(i)},
    {...shared.get('study_update_boundaries'),run:i=>{window.StudyApp.updateBoundaries(withoutScope(i));return context();}},
    {...shared.get('study_record_evidence'),run:i=>{window.StudyLearning.completeStage(i.profileId,i.stage,i.evidence);return context().progress;}},
    {...shared.get('study_record_note'),run:i=>window.StudyApp.recordNote(i.nodeIndex,i.note)},
    {...shared.get('study_start_quiz'),run:i=>{const a=window.StudyLearning.getQuiz(i.profileId);if(a&&!a.finished)throw Error('已有未完成测验，请先读取并继续作答');window.StudyLearning.startQuiz(i.profileId,i.count||6);return window.StudyLearning.getQuiz(i.profileId);}},
    {...shared.get('study_submit_answer'),run:i=>{const result=window.StudyLearning.grade(i.profileId,i.questionId,i.choiceIndex);const q=window.StudyLearning.getQuiz(i.profileId);return {feedback:result,result:q.answered===q.total?window.StudyLearning.finishQuiz(i.profileId):null,quiz:window.StudyLearning.getQuiz(i.profileId)};}},
    {...shared.get('study_get_wrong_answers'),read:true,run:()=>({questions:window.StudyLearning.getReview(profile())})}
  ];
  function assertScope(invocation) {
    const current=window.StudyApp.getContext();
    if(invocation.signal?.aborted)throw Error('这次对话已停止，学习操作未执行');
    if(hidden||invocation.lifecycle!==lifecycle||window.StudyRole?.isSwitching?.()||current.roleId!==invocation.roleId||current.profileId!==invocation.profileId)throw Error('角色或学习方向已变化，请重新读取当前上下文后再操作');
  }
  async function execute(def,input,invocation) {
    assertScope(invocation);
    await window.StudySync.ready;
    assertScope(invocation);
    if(!window.StudySync.status().verified)throw Error('请先在私人云端站点完成本人登录和同步检查');
    if(!def.read){await window.StudySync.ensureWritable();assertScope(invocation);}
    const result=def.run(input);
    if(def.read)return {ok:true,result};
    const savedScope={roleId:invocation.roleId,roleName:window.StudyRole?.name||'貔貅',profileId:def.name==='study_select_profile'?input.profileId:invocation.profileId};
    window.StudyApp.refresh();
    try {
      const saved=await window.StudySync.flush();
      if(!saved.cloudSaved)throw Error('云端尚未保存');
      return {ok:true,result,...savedScope,cloudSaved:true,revision:window.StudySync.status().revision};
    } catch(error) {
      return {ok:false,savedLocally:true,cloudSaved:false,result,...savedScope,message:error.message||'网络中断，改动保留在本机，请先处理同步再继续。'};
    }
  }
  function invoke(def,input={},signal) {
    try {
      valid(input,def.inputSchema);
      if(!window.StudyApp||!window.StudyLearning||!window.StudySync)throw Error('学习站点尚未加载完成，请稍后再试');
      const current=window.StudyApp.getContext(),invocation={roleId:current.roleId,profileId:current.profileId,lifecycle,signal};
      if(!def.read&&(input.roleId!==current.roleId||(def.name==='study_select_profile'?input.expectedProfileId:input.profileId)!==current.profileId))throw Error('指定角色或学习方向与当前页面不一致，请重新读取当前上下文');
      assertScope(invocation);
      const values=JSON.parse(JSON.stringify(input));
      const task=pendingWrite.then(()=>execute(def,values,invocation));
      if(!def.read)pendingWrite=task.catch(()=>{});
      return task;
    } catch(error) {return Promise.reject(error);}
  }
  async function register() {
    if(registered)return;
    const registry=document.modelContext;
    if(typeof registry?.registerTool!=='function'){publishStatus();return;}
    controller=new AbortController();let count=0;
    try {
      for(const def of defs) {
        await registry.registerTool({name:def.name,description:def.description,inputSchema:def.inputSchema,annotations:{readOnlyHint:Boolean(def.read),untrustedContentHint:true},execute:input=>invoke(def,input)}, {signal:controller.signal});
        count++;
      }
      registered=true;toolState={available:true,registered:count,message:`Codex 站点工具已就绪 · ${count} 项`};
    } catch(_) {
      controller.abort();toolState={available:false,registered:0,message:'站点工具未能连接，普通学习功能仍可使用'};
    }
    publishStatus();
  }
  async function executeInline(name,input,target,signal) {
    const def=defs.find(item=>item.name===name);
    if(!def||name==='study_select_profile')throw Error('这项操作不能在学习对话中执行');
    const current=window.StudyApp?.getContext?.();
    if(!target||target.roleId!==current?.roleId||target.profileId!==current?.profileId)throw Error('对话角色或学习方向已变化，本次操作未执行');
    return invoke(def,input,signal);
  }
  window.StudyTools=Object.freeze({status:()=>({...toolState}),executeInline});
  window.addEventListener('study-role-leaving',()=>{lifecycle++;});
  window.addEventListener('pagehide',()=>{lifecycle++;hidden=true;controller?.abort();registered=false;});
  window.addEventListener('pageshow',e=>{if(e.persisted){hidden=false;void register();}});
  void register();
})();
