const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../tools/daesin-registration-test/extension');
const carrier='https://partner.ds3211.co.kr',daily=carrier+'/searchSvl?svcGid=customer.search&svcSid=dailySearch';
function worker({existing=false,result={rows:[],workbook:'',shipmentDate:'2026-10-07'}}={}){
 let listener;const store={},created=[],updates=[],queries=[],scripts=[];
 const tabs=existing?[{id:8,windowId:2,url:daily,active:false}]:[];
 const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},
  storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(store[k])])),set:async data=>Object.assign(store,structuredClone(data))}},
  tabs:{query:async q=>{queries.push(q);return tabs.filter(t=>t.url===daily&&(!q.windowId||t.windowId===q.windowId));},
   create:async p=>{created.push(p);const tab={...p,id:10+tabs.length,status:'complete'};tabs.push(tab);return tab;},get:async id=>tabs.find(t=>t.id===id),update:async(id,p)=>{updates.push({id,...p});return {...tabs.find(t=>t.id===id),...p};}},
  scripting:{executeScript:async p=>{scripts.push(p.func.name);return [{result:p.func.name==='fetchDaesinDailyWorkbook'?result:p.func.name==='inspectCarrierDestination'?{row:{arrival_agencycode:'0000',unregistered_post:'도착지 우편번호 정보가 없습니다.'}}:{}}];}}};
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,structuredClone,crypto});ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),ctx));
 vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),ctx);
 const send=(message,sender={url:'https://cargo-shipping-app.vercel.app/',frameId:0,tab:{id:1,windowId:2}})=>new Promise(resolve=>listener(message,sender,resolve));
 return {send,created,updates,queries,scripts,store};
}
test('refresh opens the missing daily tab in the app window without changing selection',async()=>{
 const w=worker();assert.equal((await w.send({action:'fetch-daily',shipmentDate:'2026-10-07'})).ok,true);
 assert.equal(w.created.length,1);assert.equal(w.created[0].active,false);assert.equal(w.created[0].windowId,2);assert.equal(w.updates.length,0);
 await w.send({action:'fetch-daily',shipmentDate:'2026-10-07'});assert.equal(w.created.length,1);assert.equal(w.queries[0].windowId,2);assert.equal(w.scripts.length,2);
});
test('refresh reuses a daily tab and only an explicit expired-login response activates it',async()=>{
 for(const [result,focus] of [[{rows:[],workbook:''},false],[{error:'조회 오류'},false],[{code:'LOGIN_REQUIRED',error:'로그인 필요'},true]]){
  const w=worker({existing:true,result});const reply=await w.send({action:'fetch-daily',shipmentDate:'2026-10-07'});
  assert.equal(reply.ok,!result.error);assert.equal(w.created.length,0);assert.equal(w.updates.length,Number(focus));
  if(focus){assert.equal(w.updates[0].id,8);assert.equal(w.updates[0].active,true);}
 }
});
test('registration and repeat requests leave the app selected; postal upload refusal is not registered',async()=>{
 const w=worker(),payload={workbook:'eA==',shipmentId:'1',fingerprint:'a'.repeat(64),receiver:'예시',shipmentDate:'2026-10-07',attemptId:crypto.randomUUID(),autoRegister:true,source:{quantity:1,fare:4400}};
 const r=await w.send({action:'stage',payload});assert.equal(r.ok,true);assert.equal(w.created[0].active,false);assert.equal(w.created[0].windowId,2);
 const repeat=await w.send({action:'stage',payload});assert.equal(repeat.repeated,true);assert.equal(w.created.length,1);assert.equal(w.updates.length,0);
 const j=w.store.sanghwaLiveRegistrationJobs[0];
 await w.send({type:'carrier-event',jobId:j.id,nonce:j.nonce,detail:{kind:'upload-response',result:'ERROR',message:'도착지 우편번호 정보가 없습니다.',rowCount:0,destinations:[]}},{url:carrier+'/issueSvl',frameId:0,tab:{id:j.tabId}});
 const saved=w.store.sanghwaLiveRegistrationJobs[0];assert.equal(saved.state,'not-registered');assert.match(saved.message,/우편번호/);assert.equal(w.scripts.includes('clickCarrierRegisterNoPrint'),false);assert.equal(w.updates.length,0);
});
test('daily page marks missing login separately from ordinary query failures',async()=>{
 const ctx=vm.createContext({URL,location:{href:carrier+'/login'},document:{querySelector:()=>null}});
 vm.runInContext(fs.readFileSync(path.join(dir,'daily-export.js'),'utf8'),ctx);
 const r=await ctx.fetchDaesinDailyWorkbook('2026-10-07');assert.equal(r.code,'LOGIN_REQUIRED');assert.match(r.error,/로그인/);
});
test('postal rejection stays distinct from shared/unassigned but accepted destinations',()=>{
 const {classifyDaesinDestination:c}=require(path.join(dir,'registration-policy.js'));
 for(const reason of ['우편번호 정보가 없습니다.','우편번호 누락','우편번호 미입력'])assert.equal(c({upload:{rowCount:1,destinations:[{arrival_agencycode:'0000',unregistered_post:reason}]}}).kind,'blocked');
 assert.equal(c({upload:{rowCount:1,destinations:[{arrival_agencycode:'0000',unregistered_post:'공동관할구역'}]}}).kind,'destination-review');
});
