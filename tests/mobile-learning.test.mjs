import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {learningScope} from '../local/codex-client.mjs';
const source = await readFile(new URL('../dist/learning.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function engine(role='apple', store=new Map()) {
  const context = {window: {StudyRole:{storageKey: key=>role==='apple'?key:key+':'+role}, localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},dispatchEvent(){},CustomEvent:class{}}};
  vm.runInNewContext(source,context);
  return context.window.StudyLearning;
}
function finish(learning, profile, count=12, correct=true) {
  learning.startQuiz(profile,count);
  const active=learning.getQuiz(profile);
  // This is a synthetic test attempt, never a learner's actual record.
  for(const q of active.questions) {
    let choice=0;
    if(correct) {
      // Probe isolated test engines; production public questions do not expose answers.
      for(;choice<3;choice++) {
        const probe=engine();probe.importData(JSON.stringify(learning.exportData()));
        if(probe.grade(profile,q.id,choice).correct)break;
      }
    }
    learning.grade(profile,q.id,choice);
  }
  return learning.finishQuiz(profile);
}
test('mobile starts empty and has two reference questions per node, without answers',()=>{
 const l=engine(), q=plain(l.getQuestions('mobile'));
 assert.equal(q.length,12);assert.equal(new Set(q.map(x=>x.id)).size,12);
 for(let i=0;i<6;i++)assert.equal(q.filter(x=>x.nodeIndex===i).length,2);
 assert.ok(q.every(x=>!('correctIndex' in x)&&!('explanation' in x)));
 assert.deepEqual(plain(l.get('mobile').completedStages),[]);
 assert.deepEqual(plain(l.get('mobile').recentEvidence),[]);
 assert.equal(l.get('mobile').quiz.bestScore,null);
 assert.ok(l.getNodeMastery('mobile').every(n=>n.score===0));
});
test('legacy three/four-direction snapshots preserve attempts, active answers and evidence',()=>{
 const l=engine();finish(l,'product');
 l.completeStage('coding','learn','synthetic legacy evidence');
 l.startQuiz('custom',6);l.grade('custom',l.getQuiz('custom').questions[0].id,1);
 const four=plain(l.exportData());delete four.profiles.mobile;
 const restored=engine();restored.importData(JSON.stringify(four));
 for(const id of ['product','coding','custom','fde'])assert.deepEqual(plain(restored.exportData().profiles[id]),four.profiles[id]);
 assert.equal(restored.get('mobile').quiz.bestScore,null);
 const three=plain(four);delete three.profiles.fde;
 restored.importData(JSON.stringify(three));
 assert.deepEqual(plain(restored.exportData().profiles.product),three.profiles.product);
 assert.deepEqual(plain(restored.get('fde').recentEvidence),[]);
 const bad=plain(four);delete bad.profiles.product;
 const before=plain(restored.exportData());assert.throws(()=>restored.importData(JSON.stringify(bad)));assert.deepEqual(plain(restored.exportData()),before);
 bad.profiles.product=four.profiles.product;bad.profiles.unknown={};assert.throws(()=>restored.importData(JSON.stringify(bad)));
});
test('full reference quiz, duplicate answers, wrong-answer review and framework time cutoff retain rules',()=>{
 const l=engine();assert.throws(()=>l.completeStage('mobile','quiz','no actual passing attempt'));
 finish(l,'mobile',1);assert.ok(!l.get('mobile').completedStages.includes('quiz'));
 l.reset('mobile');const result=finish(l,'mobile');assert.equal(result.score,100);assert.equal(result.passed,true);
 assert.ok(l.get('mobile').completedStages.includes('quiz'));
 assert.ok(!l.get('mobile').completedStages.includes('project'));
 assert.ok(l.getNodeMastery('mobile',{since:Date.now()+1000}).every(n=>n.score===0));
 assert.deepEqual(plain(l.getReview('mobile')),[]);
 l.reset('mobile');l.startQuiz('mobile',1);const q=l.getQuiz('mobile').questions[0];
 let wrong=0;for(;wrong<3;wrong++){const p=engine();p.importData(JSON.stringify(l.exportData()));if(!p.grade('mobile',q.id,wrong).correct)break;}
 l.grade('mobile',q.id,wrong);assert.equal(l.grade('mobile',q.id,(wrong+1)%3).duplicate,true);l.finishQuiz('mobile');
 assert.equal(l.getReview('mobile').length,1);l.startReview('mobile');assert.equal(l.getQuiz('mobile').kind,'review');
});
test('each role uses its existing key; resetting mobile leaves all other data intact',()=>{
 const store=new Map(),apple=engine('apple',store),sheep=engine('sheep',store);
 apple.completeStage('product','learn','apple old');apple.completeStage('mobile','learn','apple mobile');
 sheep.completeStage('mobile','learn','sheep mobile');
 assert.equal(engine('apple',store).get('mobile').recentEvidence[0].text,'apple mobile');
 assert.equal(engine('sheep',store).get('mobile').recentEvidence[0].text,'sheep mobile');
 const original=plain(apple.exportData().profiles.product);apple.reset('mobile');
 assert.deepEqual(plain(apple.exportData().profiles.product),original);
 assert.equal(engine('sheep',store).get('mobile').recentEvidence.length,1);
 assert.ok(store.has('study-bloom-learning-v2'));assert.ok(store.has('study-bloom-learning-v2:sheep'));
});
test('AI tool definitions and local scope support all existing directions and mobile',async()=>{
 const c={};vm.runInNewContext(await readFile(new URL('../dist/learning-tool-defs.js',import.meta.url),'utf8'),c);
 for(const role of ['apple','sheep','bear'])for(const profile of ['product','coding','custom','fde','mobile'])assert.equal(learningScope({roleId:role,profileId:profile}),`${role}:${profile}`);
 assert.throws(()=>learningScope({roleId:'other',profileId:'mobile'}));assert.throws(()=>learningScope({roleId:'apple',profileId:'unknown'}));
 for(const tool of c.StudyToolDefinitions)for(const field of ['profileId','expectedProfileId'])if(tool.inputSchema.properties[field])assert.ok(tool.inputSchema.properties[field].enum.includes('mobile'));
});

// Rendering and data APIs run against small DOM stubs. This is not browser/visual QA.
async function appHarness(role='apple',store=new Map()) {
 const elements=new Map();
 const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',dataset:{},setAttribute(){},addEventListener(){},querySelectorAll(){return[];},focus(){}});return elements.get(selector);},addEventListener(){},body:{classList:{toggle(){}}}};
 const context={document,location:{hash:'#framework'},URL,URLSearchParams,console,setInterval(){},setTimeout(){},clearTimeout(){},CustomEvent:class{},addEventListener(){},dispatchEvent(){},
   StudyRole:{id:role,name:role,storageKey:key=>role==='apple'?key:key+':'+role},
   localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}};
 context.window=context;vm.createContext(context);
 vm.runInContext(source,context);
 vm.runInContext(await readFile(new URL('../dist/wiki.js',import.meta.url),'utf8'),context);
 vm.runInContext(await readFile(new URL('../dist/app.js',import.meta.url),'utf8'),context);
 return {context,app:context.StudyApp,learning:context.StudyLearning,elements};
}
test('app selection, Wiki guide, notes/materials and framework updates respect direction and role',async()=>{
 const store=new Map(), a=await appHarness('apple',store),s=await appHarness('sheep',store);
 assert.match(a.elements.get('#main-content').innerHTML,/data-action="profile" data-id="mobile"/);
 a.app.recordNote(0,'old product note');const oldProduct=plain(a.app.getContext());
 a.app.selectProfile('mobile');const mobile=plain(a.app.getContext());
 assert.equal(mobile.nodes.length,6);assert.equal(mobile.nodes.filter(n=>n.completed).length,0);
 assert.equal(mobile.wikiLinks.length,7);
 assert.match(a.elements.get('#main-content').innerHTML,/mobile-roadmap.html/);
 assert.match(a.elements.get('#main-content').innerHTML,/首周小作品/);
 a.app.recordNote(0,'synthetic mobile note');
 a.app.addMaterial({title:'synthetic result',content:'test only',nodeIndex:0});
 const before=plain(a.app.exportData());
 a.app.importData({...before,completed:{...before.completed,'mobile-0':true,'product-1':true}});
 a.app.applyFramework({roleId:'apple',profileId:'mobile',summary:'synthetic update',nodes:mobile.nodes.map(n=>({title:n.name,description:n.description,exercise:n.exercise,acceptance:n.acceptance})),boundaries:mobile.boundaries});
 assert.equal(a.app.getContext().nodes[0].note,'synthetic mobile note');
 assert.ok(a.app.getContext().nodes.every(n=>!n.completed));
 assert.equal(a.app.exportData().completed['product-1'],true);
 assert.equal(a.app.listMaterials().length,1);
 assert.throws(()=>a.app.applyFramework({roleId:'sheep',profileId:'mobile'}));
 a.app.selectProfile('product');assert.equal(a.app.getContext().nodes[0].note,oldProduct.nodes[0].note);
 assert.equal(a.app.listMaterials().length,0);
 s.app.selectProfile('mobile');assert.equal(s.app.getContext().nodes[0].note,'');assert.equal(s.app.listMaterials().length,0);
 assert.throws(()=>s.app.importData({...before,roleId:'apple'}));
 a.app.selectProfile('mobile');
 const reload=await appHarness('apple',store);assert.equal(reload.app.getContext().profileId,'mobile');assert.equal(reload.app.getContext().nodes[0].note,'synthetic mobile note');
});
test('built Worker accepts mobile snapshots, legacy snapshots and rejects unknown profiles',async()=>{
 const built=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
 const {validateSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(built).toString('base64'));
 const {app,learning}=await appHarness();app.selectProfile('mobile');app.recordNote(0,'synthetic cloud note');
 app.addMaterial({title:'synthetic cloud material',content:'test only',nodeIndex:0});app.setImaTarget({id:'test-library',name:'test library'});
 const snapshot=plain({app:app.exportData(),learning:learning.exportData()});
 assert.deepEqual(validateSnapshot(snapshot),snapshot);
 const legacy=plain(snapshot);legacy.app.profile='product';delete legacy.learning.profiles.mobile;
 assert.equal(validateSnapshot(legacy).learning.profiles.mobile.quiz.active,null);
 const bad=plain(snapshot);bad.app.profile='unknown';assert.throws(()=>validateSnapshot(bad));
 const badLearning=plain(snapshot);badLearning.learning.profiles.unknown={};assert.throws(()=>validateSnapshot(badLearning));
});
