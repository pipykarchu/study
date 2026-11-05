// Real Chromium regression; fixture APIs only arrange legacy state/read assertions.
// npm install --no-save --package-lock=false playwright@1.62.1
// CHROMIUM_PATH=/usr/bin/chromium node scripts/check-mobile-browser.mjs
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); } catch {
 console.error('ENVIRONMENT BLOCKED: install playwright@1.62.1; browser cases NOT RUN.');process.exit(2);
}
const root=resolve(new URL('../dist/',import.meta.url).pathname);
const out=resolve(process.env.BROWSER_QA_DIR||new URL('../qa/mobile-browser/',import.meta.url).pathname);
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
 try {
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(relative(root,path).startsWith('..'))throw Error('outside root');
  const data=await readFile(path);
  res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const results=[], errors=[], blocked=[], layouts=[];
let browser, environmentError=null;
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}console.log(results.at(-1));}
async function context(width){
 const c=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,serviceWorkers:'block'});
 c.setDefaultTimeout(8000);c.setDefaultNavigationTimeout(15000);
 await c.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin||u.pathname.startsWith('/api/')){blocked.push({url:u.href,method:route.request().method()});return route.abort('blockedbyclient');}
  return route.continue();
 });
 c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 return c;
}
const mobile=p=>p.locator('[data-action="profile"][data-id="mobile"]');
async function open(p,role='apple'){await p.goto(`${origin}/index.html?role=${role}#framework`);await mobile(p).waitFor();}
async function layout(p,name,width){
 await p.screenshot({path:resolve(out,`${name}-${width}.png`),fullPage:true});
 const data=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed';}).slice(0,12).map(e=>({tag:e.tagName,cls:e.className?.baseVal??e.className,right:Math.round(e.getBoundingClientRect().right)}))}));
 layouts.push({name,width,...data});assert.ok(data.document<=width+1,`${name}: scrollWidth ${data.document} > viewport ${width}`);
}
async function switchRole(p,role){await p.locator('.study-role-button').click();await p.locator(`#study-role-dialog [data-role="${role}"]`).click();await p.waitForURL(u=>u.searchParams.get('role')===role);await mobile(p).waitFor();}
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 for(const width of [360,390]){
  const c=await context(width),p=await c.newPage();await open(p);
  await check(`${width}: mobile click and six empty nodes`,async()=>{
   await mobile(p).click();assert.equal(await mobile(p).getAttribute('aria-pressed'),'true');
   const d=await p.evaluate(()=>({app:StudyApp.getContext(),learning:StudyLearning.get('mobile')}));
   assert.equal(d.app.nodes.length,6);assert.ok(d.app.nodes.every(n=>!n.completed&&!n.note));assert.equal(d.learning.quiz.bestScore,null);
   assert.equal(await p.locator('.wiki-node-page h3').innerText(),'基础 UI 与首周小作品');
  });
  await check(`${width}: framework narrow layout`,()=>layout(p,'framework',width));
  await check(`${width}: guide popup and return navigation`,async()=>{
   const popup=p.waitForEvent('popup');await p.locator('a[href="./mobile-roadmap.html"]').click();const guide=await popup;await guide.waitForLoadState();
   assert.match(await guide.locator('h1').innerText(),/每周交付/);assert.equal(await guide.locator('table').first().locator('tbody tr').count(),6);
   await check(`${width}: roadmap narrow layout`,()=>layout(guide,'roadmap',width));
   await guide.locator('a[href="./index.html#framework"]').click();await guide.waitForURL(/#framework$/);await mobile(guide).waitFor();assert.equal(await mobile(guide).getAttribute('aria-pressed'),'true');await guide.close();
  });
  await check(`${width}: Tab, Space and Enter direction controls`,async()=>{
   const product=p.locator('[data-action="profile"][data-id="product"]');await product.focus();await p.keyboard.press('Enter');
   assert.equal(await product.getAttribute('aria-pressed'),'true');await product.focus();
   let reached=false;for(let i=0;i<8;i++){await p.keyboard.press('Tab');if(await mobile(p).evaluate(e=>e===document.activeElement)){reached=true;break;}}
   assert.ok(reached,'mobile reachable by Tab');await p.keyboard.press('Space');assert.equal(await mobile(p).getAttribute('aria-pressed'),'true');
  });
  await check(`${width}: note save by keyboard, live feedback, reload`,async()=>{
   await p.locator('[data-wiki-note]').fill(`SYNTHETIC apple ${width}`);
   const save=p.locator('[data-wiki-note-form] button[type="submit"]');await save.focus();await p.keyboard.press('Enter');
   assert.match(await p.locator('[data-wiki-message]').innerText(),/笔记已保存/);
   await p.reload();await p.locator('[data-wiki-note]').waitFor();assert.equal(await p.locator('[data-wiki-note]').inputValue(),`SYNTHETIC apple ${width}`);
  });
  await check(`${width}: material buttons, validation and save`,async()=>{
   await p.locator('[data-wiki-action="collect-note"]').click();const f=p.locator('[data-wiki-material-form]');
   await f.locator('[name="title"]').fill('');await f.locator('[type="submit"]').click();assert.equal(await f.locator('[name="title"]').evaluate(e=>e.validity.valueMissing),true);
   await f.locator('[name="title"]').fill(`SYNTHETIC material ${width}`);await f.locator('[type="submit"]').click();assert.equal(await p.locator('.wiki-material-card').count(),1);
  });
  await check(`${width}: materials narrow layout`,()=>layout(p,'materials',width));
  await check(`${width}: UI role switch isolates notes, materials and answers`,async()=>{
   // A partial synthetic attempt is fixture setup only, not a quiz-interaction pass.
   const saved=await p.evaluate(()=>{StudyLearning.startQuiz('mobile',12);const q=StudyLearning.getQuiz('mobile');StudyLearning.grade('mobile',q.questions[0].id,0);return {app:StudyApp.exportData(),learning:StudyLearning.exportData()};});
   for(const role of ['sheep','bear']){
    await p.locator('.study-role-button').click();if(role==='bear')await p.locator('.role-add-small').click();await p.locator(`[data-role="${role}"]`).click();await p.waitForURL(u=>u.searchParams.get('role')===role);await mobile(p).waitFor();await mobile(p).click();
    assert.equal(await p.locator('[data-wiki-note]').inputValue(),'');
    assert.deepEqual(await p.evaluate(()=>StudyApp.listMaterials()),[]);assert.ok(!(await p.evaluate(()=>StudyLearning.getQuiz('mobile'))));
    await p.locator('[data-wiki-note]').fill(`SYNTHETIC ${role}`);await p.locator('[data-wiki-note-form] [type="submit"]').click();
   }
   await switchRole(p,'apple');assert.equal(await mobile(p).getAttribute('aria-pressed'),'true');
   assert.equal(await p.locator('[data-wiki-note]').inputValue(),`SYNTHETIC apple ${width}`);
   assert.deepEqual(await p.evaluate(()=>({app:StudyApp.exportData(),learning:StudyLearning.exportData()})),saved);
  });
  await check(`${width}: page navigation by keyboard`,async()=>{
   const link=p.locator('#navigation a[href="#method"]');await link.focus();await p.keyboard.press('Enter');await p.waitForURL(/#method$/);assert.match(await p.locator('h1').innerText(),/学习/);
   await p.locator('#navigation a[href="#garden"]').click();await p.waitForURL(/#garden$/);assert.equal(await mobile(p).getAttribute('aria-pressed'),'true');
  });
  await check(`${width}: garden narrow layout`,()=>layout(p,'garden',width));
  await c.close();
 }
 // Build authentic pre-mobile learning schemas with the parent revision's engine.
 const oldSource=execFileSync('git',['show','b9233fb:dist/learning.js'],{cwd:resolve(root,'..'),encoding:'utf8'});
 for(const count of [3,4]){
  const store=new Map(),scope={window:{localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},dispatchEvent(){},CustomEvent:class{}}};vm.runInNewContext(oldSource,scope);
  const old=scope.window.StudyLearning;old.completeStage('product','learn',`SYNTHETIC legacy ${count}`);old.startQuiz('product',12);for(const q of old.getQuiz('product').questions)old.grade('product',q.id,0);old.finishQuiz('product');
  const learning=JSON.parse(JSON.stringify(old.exportData()));if(count===3)delete learning.profiles.fde;
  const app={version:1,profile:'product',notes:{'product-0':`SYNTHETIC legacy note ${count}`},completed:{'product-0':true}};
  const c=await context(390);await c.addInitScript(({app,learning})=>{if(!sessionStorage.getItem('fixture-seeded')){localStorage.setItem('study-bloom-v1',JSON.stringify(app));localStorage.setItem('study-bloom-learning-v2',JSON.stringify(learning));sessionStorage.setItem('fixture-seeded','yes');}},{app,learning});const p=await c.newPage();await open(p);
  await check(`legacy ${count}: real page renders old note, check and score after reload`,async()=>{
   assert.equal(await p.locator('[data-wiki-note]').inputValue(),app.notes['product-0']);assert.match(await p.locator('.wiki-node-facts').innerText(),/已记录/);
   assert.match(await p.locator('.wiki-progress').innerText(),new RegExp(learning.profiles.product.quiz.bestScore+'分'));
   assert.deepEqual(await p.evaluate(()=>StudyLearning.exportData().profiles.product),learning.profiles.product);
   await p.reload();await mobile(p).waitFor();assert.equal(await p.locator('[data-wiki-note]').inputValue(),app.notes['product-0']);
   await mobile(p).click();assert.equal(await p.locator('[data-wiki-note]').inputValue(),'');assert.equal(await p.evaluate(()=>StudyLearning.get('mobile').quiz.bestScore),null);
   await p.locator('[data-action="profile"][data-id="product"]').click();assert.equal(await p.locator('[data-wiki-note]').inputValue(),app.notes['product-0']);
   await p.screenshot({path:resolve(out,`legacy-${count}.png`),fullPage:true});
  });await c.close();
 }
 await check('no uncaught browser JavaScript errors',()=>assert.deepEqual(errors,[]));
}catch(error){
 environmentError=error.message;results.push({name:'browser suite',status:'BLOCKED',error:environmentError});console.error('ENVIRONMENT BLOCKED / suite incomplete:',environmentError);
}finally{
 const report={overall:environmentError?'BLOCKED':results.some(x=>x.status==='FAIL')?'FAIL':'PASS',environmentError,executed:results.filter(x=>['PASS','FAIL'].includes(x.status)).length,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser?.version(),playwright:require('playwright/package.json').version,results,layouts,errors,blocked,limitations:['Desktop headless Chromium viewport checks are not physical-device, touch, mobile IME, Safari or screen-reader validation.','API/cloud/ima and production authorization are not exercised; external/API requests are blocked.']};
 await writeFile(resolve(out,'results.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));
}
if(environmentError)process.exitCode=2;else if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
