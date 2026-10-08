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
 const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
 const saved={},calls=[];let listener;
 const chrome={storage:{local:{get:async k=>({[k]:saved[k]}),set:async v=>Object.assign(saved,structuredClone(v))}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f}}};
 const sandbox=vm.createContext({URL,AbortSignal,console,chrome,crypto:require("node:crypto").webcrypto,structuredClone,setTimeout,clearTimeout,
  fetch:async(url,options)=>{calls.push({url,body:options.body});if(options.body==='')return{ok:true};if(mode==='lost')throw Error('connection lost after dispatch');
   if(mode==='progress'){
    const body=JSON.parse(options.body);
    if(!url.endsWith('/checkStatus'))return response({Result:'ready',RequestID:String(body.id),ResponseID:7321});
    if(typeof body.RequestID!=='number'||typeof body.ResponseID!=='string')return response({Result:'error json data'});
    // Native checkResult retains the initial identifiers even when a progress reply omits them.
    const polls=calls.filter(c=>c.url.endsWith('/checkStatus')).length;
    return response({Result:polls%2?'progress':'success'});
   }
   return response({Result:mode});}});
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

test('preflight checks native completion without print, feed, clear or label data',async()=>{
 const w=worker('progress');
 const checked=await w.send('print-diagnose');assert.equal(checked.diagnostic.passed,true);
 const requests=w.calls.filter(c=>c.body!==''&&!c.url.endsWith('/checkStatus'));
 assert.equal(requests.length,1);
 assert.deepEqual(JSON.parse(requests[0].body).functions,{func0:{checkLabelStatus:[]}});
 assert.equal(w.calls.filter(c=>c.url.endsWith('/checkStatus')).length,2);
 const saved=await w.send('print-diagnostics');assert.equal(saved.diagnostic.kind,'status-only');
 assert.equal(saved.diagnostic.version,'0.7.3');
 assert(saved.diagnostic.steps.some(s=>s.path==='/checkStatus'&&s.response.Result==='success'));
});
test('failed response preflight is reported honestly and never dispatches a label',async()=>{
 const w=worker('error json data');const result=await w.send('print-diagnose');
 assert.equal(result.diagnostic.passed,false);assert.match(result.diagnostic.message,/송장은 보내지 않았습니다/);
 assert.equal(w.calls.filter(c=>c.body!=='').length,1);
 assert(!w.calls.some(c=>c.body.includes('printBuffer')));
 assert.equal(result.diagnostic.steps[0].response.Result,'error json data');
});
test('diagnostic actions are rejected from shipment pages and cannot accept custom commands',async()=>{
 const w=worker();for(const action of ['print-diagnose','print-diagnostics'])assert.equal((await w.send(action,{},'/')).ok,false);
 assert.equal(w.calls.length,0);
 await w.send('print-diagnose',{functions:{func0:{printBuffer:[]}},url:'http://other.invalid'});
 assert(!w.calls.some(c=>c.body.includes('printBuffer')));
});

test('blank freight text is omitted but visible commands, exact box barcodes and copies are unchanged',async()=>{
 const w=worker('progress');
 const font=text=>({drawTrueTypeFont:[text,120,305,'Arial',25,0,false,false,false,true]});
 const labels=[1,2,3].map(index=>{
  const base=label(index),commands=[base.functions.func0,base.functions.func1,{setDensity:[18]},{setOrientation:['T']}];
  for(const text of ['배송지','', '수화주', '0', ' ', '제주', '주소수정'])commands.push(font(text));
  commands.push({drawDeviceFont:['',500,405,'e',2,2,0,false,true,0]},base.functions.func2,base.functions.func3);
  return {id:base.id,functions:Object.fromEntries(commands.map((c,i)=>['func'+i,c]).sort(([a],[b])=>a.localeCompare(b)))};
 });
 const original=structuredClone(labels),job={id:'00000000-0000-4000-8000-000000000031',waybill_no:bill,labels};
 const result=await w.send('print-send',{job});assert.equal(result.state,'sent');assert.equal(result.completed,3);
 const emitted=w.calls.filter(c=>c.body&&!c.url.endsWith('/checkStatus')).map(c=>JSON.parse(c.body));
 assert.equal(emitted.length,3);assert.deepEqual(labels,original,'source job must remain immutable');
 emitted.forEach((actual,index)=>{
  const originalCommands=Object.entries(original[index].functions).sort(([a],[b])=>Number(a.slice(4))-Number(b.slice(4))).map(([,c])=>c);
  const emptyCommands=originalCommands.filter(c=>c.drawTrueTypeFont?.[0]===''||c.drawDeviceFont?.[0]==='');
  const expectedCommands=originalCommands.filter(c=>!emptyCommands.includes(c));
  assert.deepEqual(Object.values(actual.functions),expectedCommands,'preserve every other argument and command');
  assert.deepEqual(Object.keys(actual.functions),expectedCommands.map((_,i)=>'func'+i),'no numbering gaps');
  assert.equal(actual.id,original[index].id);
  assert.equal(expectedCommands.filter(c=>c.printBuffer).length,1);
  assert(expectedCommands.some(c=>c.draw1DBarcode?.[0]===bill+String(index+1).padStart(3,'0')));
 });
 const diagnostic=await w.send('print-diagnostics');assert.equal(diagnostic.diagnostic.omittedEmptyText,6);
 await w.send('print-send',{job});assert.equal(w.calls.filter(c=>c.body&&!c.url.endsWith('/checkStatus')).length,3);
});
test('unsupported blank commands are rejected before normalization; actual errors still halt and cannot replay',async()=>{
 const w=worker(),invalid=label();invalid.functions.func1={directDrawHex:['']};
 const job={id:'00000000-0000-4000-8000-000000000032',waybill_no:bill,labels:[invalid]};
 assert.equal((await w.send('print-send',{job})).ok,false);assert.equal(w.calls.length,0);
 const rejected=worker('error json data');job.labels=[label()];
 assert.equal((await rejected.send('print-send',{job})).state,'unknown');
 assert.equal((await rejected.send('print-send',{job})).state,'unknown');
 assert.equal(rejected.calls.filter(c=>c.body).length,1,'error response must never be interpreted as success or retry');
});
