const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function worker(){
 const dir=path.join(__dirname,'../tools/daesin-registration-test/extension');let listener,scriptCalls=0;
 const job={id:'fixture',nonce:'fixture-nonce',tabId:4,shipmentDate:'2026-10-06',receiver:'테스트',numbers:[],state:'registered-awaiting-number',diagnosis:{upload:{rowCount:1},registration:{result:'SUCCESS'}}};
 const store={sanghwaLiveRegistrationJobs:[job],sanghwaDailyFetchHistory:[{version:'0.4.1',invalidCount:32,invalidSamples:[{value:'2140649004964',length:13}]}]};
 const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listener=f}},
  storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(store[k])])),set:async data=>Object.assign(store,structuredClone(data))}},
  tabs:{query:async()=>[{id:4,url:'https://partner.ds3211.co.kr/searchSvl?svcGid=customer.search&svcSid=dailySearch',active:true}]},
  scripting:{executeScript:()=>{scriptCalls++;return new Promise(()=>{});}}};
 const context=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,structuredClone});context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),context));
 vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),context);
 const send=(message,sender={url:'http://127.0.0.1:4320/',frameId:0})=>new Promise(resolve=>listener(message,sender,resolve));
 return {send,store,get scriptCalls(){return scriptCalls;}};
}
async function promptly(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Report waited for stalled carrier operation')),1000))]);}finally{clearTimeout(timer);}}
test('stored report bypasses a stalled carrier operation and preserves 0.4.1 diagnostics',async()=>{
 const w=worker();void w.send({action:'fetch-daily',shipmentDate:'2026-10-06'});await new Promise(resolve=>setImmediate(resolve));assert.equal(w.scriptCalls,1);
 const result=await promptly(w.send({action:'report'}));assert.equal(result.ok,true);assert.equal(result.report.activeOperation.action,'fetch-daily');assert.equal(result.report.fetchHistory[0].invalidCount,32);assert.equal(result.report.fetchHistory[0].invalidSamples[0].value,'2140649004964');assert.equal(result.report.jobs.length,1);assert.equal(w.scriptCalls,1);
 assert.equal((await promptly(w.send({action:'report'},{url:'https://other.invalid',frameId:0}))).ok,false);
});
test('registration response keeps an entire 13-digit number and does not truncate longer identifiers',async()=>{
 for(const numbers of [['2140649004964'],['21406490049640']]){
  const w=worker();await w.send({type:'carrier-event',jobId:'fixture',nonce:'fixture-nonce',detail:{kind:'registration-response',result:'SUCCESS',numbers}},{url:'https://partner.ds3211.co.kr/issueSvl',frameId:0,tab:{id:4}});
  const job=w.store.sanghwaLiveRegistrationJobs[0];assert.deepEqual(job.numbers,numbers[0].length===13?numbers:[]);
 }
});
