const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'../tools/daesin-registration-test/extension');
const {validateDaesinPrintLabels}=require(path.join(dir,'print-carrier.js'));
const bill='9999999999991';
const label=(i=1)=>({id:100+i,functions:{func0:{checkLabelStatus:[]},func1:{clearBuffer:[]},func2:{draw1DBarcode:[bill+String(i).padStart(3,'0'),80,780,2,3,10,70,0,1]},func3:{printBuffer:[]}}});
test('only bounded single-copy native label commands and exact per-box barcodes can print',()=>{
 assert.equal(validateDaesinPrintLabels([label(),label(2)],bill),true);
 for(const mutation of [v=>v[0].functions.func3.printBuffer=[2],v=>v[0].functions.func2.draw1DBarcode[0]='9999999999992001',v=>v[0].functions.func1={directDrawHex:['escape']},v=>v[0].id=-1,v=>v.push(label())]){
  const data=[label()];mutation(data);assert.throws(()=>validateDaesinPrintLabels(data,bill));
 }
});
function worker(mode='success'){
 const saved={},calls=[];let listener;
 const chrome={storage:{local:{get:async k=>({[k]:saved[k]}),set:async v=>Object.assign(saved,structuredClone(v))}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f}}};
 const sandbox=vm.createContext({URL,AbortSignal,console,chrome,structuredClone,setTimeout,clearTimeout,
  fetch:async(url,options)=>{calls.push({url,body:options.body});if(options.body==='')return{ok:true};if(mode==='lost')throw Error('connection lost after dispatch');
   if(mode==='progress'){
    const body=JSON.parse(options.body);
    if(!url.endsWith('/checkStatus'))return{ok:true,json:async()=>({Result:'ready',RequestID:String(body.id),ResponseID:7321})};
    if(typeof body.RequestID!=='number'||typeof body.ResponseID!=='string')return{ok:true,json:async()=>({Result:'error json data'})};
    // Native checkResult retains the initial identifiers even when a progress reply omits them.
    const polls=calls.filter(c=>c.url.endsWith('/checkStatus')).length;
    return{ok:true,json:async()=>({Result:polls%2?'progress':'success'})};
   }
   return{ok:true,json:async()=>({Result:mode})};}});
 sandbox.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),sandbox));
 vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),sandbox);
 const send=(action,patch={},pathname='/print-station')=>new Promise(resolve=>listener({action,...patch},{url:'https://cargo-shipping-app.vercel.app'+pathname,frameId:0,tab:{id:1,windowId:1}},resolve));
 return{send,calls,saved};
}
test('print requests only run from the dedicated station and never from the shipping list',async()=>{
 const w=worker();assert.equal((await w.send('print-probe',{},'/')).ok,false);assert.equal(w.calls.length,0);
 assert.equal((await w.send('print-probe')).ok,true);assert.equal(w.calls.length,1);assert.equal(w.calls[0].body,'','probe cannot print');
});
test('printer dispatch persists before sending and repeated jobs return the saved outcome without printing',async()=>{
 const w=worker(),job={id:'00000000-0000-4000-8000-000000000001',waybill_no:bill,labels:[label(),label(2)]};
 assert.equal((await w.send('print-send',{job})).state,'sent');assert.equal(w.calls.filter(c=>c.body!=='').length,2);
 assert.equal((await w.send('print-send',{job})).state,'sent');assert.equal(w.calls.filter(c=>c.body!=='').length,2);
 assert(w.calls.every(c=>c.url==='http://127.0.0.1:18080/mPrintServer/Printer1'));
});
test('unknown printing results are not replayed on a later attempt or service-worker restart',async()=>{
 const w=worker('lost'),job={id:'00000000-0000-4000-8000-000000000002',waybill_no:bill,labels:[label()]};
 assert.equal((await w.send('print-send',{job})).state,'unknown');assert.equal((await w.send('print-send',{job})).state,'unknown');
 assert.equal(w.calls.filter(c=>c.body!=='').length,1);
 w.saved['sanghwaPrint:'+job.id]={state:'sending'};
 assert.equal((await w.send('print-send',{job})).state,'unknown');assert.equal(w.calls.filter(c=>c.body!=='').length,1);
});

test('Chrome and JSONB property ordering is normalized before print',async()=>{
 const original=label();const functions={func0:original.functions.func0,func1:original.functions.func1};
 for(let i=2;i<12;i++)functions['func'+i]={drawTrueTypeFont:['label',1,1,'Arial',20,0,false,false,false,false]};
 functions.func12=original.functions.func2;functions.func13=original.functions.func3;
 const data={id:77,functions:Object.fromEntries(Object.entries(functions).sort(([a],[b])=>a.localeCompare(b)))};
 assert.equal(validateDaesinPrintLabels([data],bill),true);
 const w=worker();await w.send('print-send',{job:{id:'00000000-0000-4000-8000-000000000009',waybill_no:bill,labels:[data]}});
 const emitted=JSON.parse(w.calls.find(c=>c.body!=='').body);
 assert.deepEqual(Object.keys(emitted.functions),Array.from({length:14},(_,i)=>'func'+i));
});

// Daesin's bxlcommon.makeResultInquiryData sends RequestID as a number and ResponseID as a string.
test('native ready/progress protocol completes consecutive jobs and all three box labels',async()=>{
 const w=worker('progress');
 for(let index=0;index<2;index++){
  const job={id:'00000000-0000-4000-8000-00000000002'+index,waybill_no:bill,labels:index===0?[label()]:[label(),label(2),label(3)]};
  const result=await w.send('print-send',{job});
  assert.equal(result.state,'sent',result.message);
  assert.equal(result.completed,job.labels.length);
  await w.send('print-send',{job});
 }
 const labels=w.calls.filter(c=>c.body!==''&&!c.url.endsWith('/checkStatus'));
 assert.equal(labels.length,4,'no repeated physical dispatch while polling or reopening a completed job');
 const polls=w.calls.filter(c=>c.url.endsWith('/checkStatus'));
 assert.equal(polls.length,8);
 assert.deepEqual(polls.map(c=>JSON.parse(c.body).RequestID),[101,101,101,101,102,102,103,103]);
 assert(polls.every(c=>JSON.parse(c.body).ResponseID==='7321'));
});
