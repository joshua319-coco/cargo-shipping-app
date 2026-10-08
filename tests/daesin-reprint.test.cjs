const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../lib/daesin-print.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const snapshot={receiver:'수정수화주',receiverPhone:'01011112222',sender:'발화주',senderPhone:'0211112222',qty:2,fare:9900,delivery:'정기',pay:'착불',address:'',branch:'예시',shipmentDate:'2026-10-08',item:'부품',pack:'박스',memo:''};
function client(mode){
 const calls=[],bridgeCalls=[];let callback,queued=false;const origin='https://cargo-shipping-app.vercel.app';
 const window={addEventListener:(_type,fn)=>{callback=fn;},removeEventListener:()=>{},postMessage:request=>{bridgeCalls.push(request);const result=request.action==='ping'?{ok:true,printStation:true}:mode==='mismatch'?{ok:false,error:'수화주 확인이 필요합니다.'}:{ok:true,labels:[{id:1},{id:2}]};queueMicrotask(()=>callback({source:window,origin,data:{channel:'sanghwa-live-response',requestId:request.requestId,result}}));}};
 const supabase={rpc:async(name,params)=>{
  calls.push({name,params});if(queued)return{data:{print:{id:params.p_request_id,state:'queued'}}};
  if(params.p_labels){queued=true;if(mode==='lost')return{error:{message:'response lost after enqueue'}};return{data:{print:{id:params.p_request_id,state:'queued'}}};}
  return{data:{needsPreparation:true,snapshot,previousSnapshot:{...snapshot,qty:1,receiver:'이전수화주'},previousState:'sent'}};
 }};
 const exports={};vm.runInNewContext(source,{exports,require:()=>({supabase}),crypto:require('node:crypto').webcrypto,window,location:{origin},setTimeout,clearTimeout,queueMicrotask});
 return {api:exports,calls,bridgeCalls};
}
test('opening/cancelling reprint only reads a preview and never prepares or queues labels',async()=>{
 const c=client();const preview=await c.api.prepareDaesinReprint('1','9999999999991','00000000-0000-4000-8000-000000000001','2026-10-08');
 assert.equal(preview.snapshot.qty,2);assert.equal(preview.previousSnapshot.qty,1);assert.equal(c.calls.length,1);assert.equal(c.bridgeCalls.length,0);assert.equal(c.calls[0].params.p_labels,undefined);
});
test('reprint verifies the current source with carrier and cannot enqueue a mismatched recipient',async()=>{
 const c=client('mismatch'),preview=await c.api.prepareDaesinReprint('1','9999999999991','00000000-0000-4000-8000-000000000001','2026-10-08');
 await assert.rejects(()=>c.api.confirmDaesinReprint(preview),/수화주/);assert(c.calls.every(c=>!c.params.p_labels));
 assert.equal(c.bridgeCalls.find(c=>c.action==='print-prepare').payload.snapshot.receiver,'수정수화주');
});
test('retry after a lost reprint enqueue response retains its ID and does not prepare or enqueue a second print',async()=>{
 const c=client('lost'),preview=await c.api.prepareDaesinReprint('1','9999999999991','00000000-0000-4000-8000-000000000001','2026-10-08');
 await assert.rejects(()=>c.api.confirmDaesinReprint(preview));
 const retry=await c.api.confirmDaesinReprint(preview);assert.equal(retry.print.id,preview.requestId);
 assert.equal(c.bridgeCalls.filter(c=>c.action==='print-prepare').length,1);assert.equal(c.calls.filter(c=>c.params.p_labels).length,1);
 assert(c.calls.every(c=>c.params.p_request_id===preview.requestId));
});
