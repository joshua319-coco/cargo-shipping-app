const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../tools/daesin-registration-test/extension');
const carrier='https://partner.ds3211.co.kr',daily=carrier+'/searchSvl?svcGid=customer.search&svcSid=dailySearch';
function worker({existing=false,proof=true,result={rows:[],workbook:'',shipmentDate:'2026-10-07'}}={}){
 let listener;const store={},created=[],updates=[],queries=[],scripts=[],removed=[];
 const tabs=existing?[{id:8,windowId:2,url:daily,active:false}]:[];
 const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},
  storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(store[k])])),set:async data=>Object.assign(store,structuredClone(data))}},
  tabs:{remove:async id=>{removed.push(id);tabs.splice(tabs.findIndex(t=>t.id===id),1);},query:async q=>{queries.push(q);return tabs.filter(t=>t.url===daily&&(!q.windowId||t.windowId===q.windowId));},
   create:async p=>{created.push(p);const tab={...p,id:10+tabs.length,status:'complete'};tabs.push(tab);return tab;},get:async id=>tabs.find(t=>t.id===id),update:async(id,p)=>{updates.push({id,...p});return {...tabs.find(t=>t.id===id),...p};}},
  scripting:{executeScript:async p=>{scripts.push(p.func.name);return [{result:p.func.name==='func'?proof:p.func.name==='fetchDaesinDailyWorkbook'?result:p.func.name==='inspectCarrierDestination'?{row:{arrival_agencycode:'0000',unregistered_post:'도착지 우편번호 정보가 없습니다.'}}:{}}];}}};
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,structuredClone,crypto});ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),ctx));
 vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),ctx);
 const send=(message,sender={url:'https://cargo-shipping-app.vercel.app/',frameId:0,tab:{id:1,windowId:2}})=>new Promise(resolve=>listener(message,sender,resolve));
 return {send,created,updates,queries,scripts,store,removed,tabs};
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

const payload=()=>({workbook:'eA==',shipmentId:'1',fingerprint:'a'.repeat(64),receiver:'예시',shipmentDate:'2026-10-07',attemptId:crypto.randomUUID(),autoRegister:true,source:{quantity:1,fare:4400,receiverPhone:'01011112222'}});
const event=(w,j,detail)=>w.send({type:'carrier-event',jobId:j.id,nonce:j.nonce,detail},{url:carrier+'/issueSvl',frameId:0,tab:{id:j.tabId}});
test('only completed, owned, inactive and untouched registration tabs close; saved results survive cleanup',async()=>{
 for(const mode of ['success','blocked','active','navigated','edited','uncertain']){
  const w=worker({proof:mode!=='edited'});await w.send({action:'stage',payload:payload()});
  const j=w.store.sanghwaLiveRegistrationJobs[0];
  if(mode==='active')w.tabs[0].active=true;if(mode==='navigated')w.tabs[0].url=daily;
  if(mode==='uncertain')await event(w,j,{kind:'unknown'});
  else if(mode==='blocked')await event(w,j,{kind:'upload-response',result:'ERROR',message:'우편번호 정보가 없습니다.',rowCount:0,destinations:[]});
  else await event(w,j,{kind:'registration-response',result:'SUCCESS',numbers:['2140649004986']});
  assert.equal(w.removed.length,['success','blocked'].includes(mode)?1:0,mode);
  if(mode==='success')assert.equal(w.store.sanghwaLiveRegistrationJobs[0].numbers[0],'2140649004986');
 }
});
test('worker rechecks deletion before retiring its journal; repeated or late messages cannot submit twice',async()=>{
 const p=payload(),w=worker();await w.send({action:'stage',payload:p});let j=w.store.sanghwaLiveRegistrationJobs[0];
 await event(w,j,{kind:'registration-response',result:'SUCCESS',numbers:['2140649004986']});
 const next={...p,attemptId:crypto.randomUUID(),deletedRegistration:{attemptId:p.attemptId,waybillNo:'2140649004986',shipmentDate:p.shipmentDate,receiver:p.receiver,receiverPhone:p.source.receiverPhone}};
 const reply=await w.send({action:'stage',payload:next});assert.equal(reply.ok,true);assert.equal(reply.repeated,undefined);assert.notEqual(reply.job.id,j.id);
 assert.equal(w.store.sanghwaLiveRegistrationJobs[0].supersededBy,next.attemptId);
 const status=await w.send({action:'status'});assert.equal(status.jobs.length,1);
 assert.equal((await w.send({action:'stage',payload:next})).repeated,true);
 assert.equal((await event(w,j,{kind:'registration-response',result:'SUCCESS',numbers:['2140649004986']})).ok,false);
 assert.equal(w.created.length,3,'old registration, reusable query, replacement registration only');
});
test('worker blocks re-registration for a refound receipt, failed lookup or uncertain local journal',async()=>{
 for(const mode of ['refound','error','unknown']){
  const p=payload(),w=worker({result:mode==='refound'?{shipmentDate:p.shipmentDate,rows:[{waybill_no:'2140649004986'}],workbook:'eA=='}:mode==='error'?{error:'조회 실패'}:{rows:[],workbook:''}});
  await w.send({action:'stage',payload:p});const j=w.store.sanghwaLiveRegistrationJobs[0];
  await event(w,j,mode==='unknown'?{kind:'unknown'}:{kind:'registration-response',result:'SUCCESS',numbers:['2140649004986']});
  const reply=await w.send({action:'stage',payload:{...p,attemptId:crypto.randomUUID(),deletedRegistration:{attemptId:p.attemptId,waybillNo:'2140649004986',shipmentDate:p.shipmentDate,receiver:p.receiver,receiverPhone:p.source.receiverPhone}}});
  assert.equal(reply.ok,false,mode);assert.equal(w.store.sanghwaLiveRegistrationJobs.length,1);assert.equal(w.store.sanghwaLiveRegistrationJobs[0].supersededBy,undefined);
 }
});
