'use strict';
// Only the dedicated print-station page may invoke this fixed local destination.
// Never accept a host, port, printer name, raw command or external URL from a job.
const DAESIN_PRINTER='http://127.0.0.1:18080/mPrintServer/Printer1';
async function probeDaesinPrinter(){
  const r=await fetch(DAESIN_PRINTER,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'',signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw new Error('이 PC의 대신 출력 프로그램(Printer1)을 확인해 주세요.');
  return {ok:true};
}
// Match Daesin's bxlcommon.makeResultInquiryData: numeric RequestID, string ResponseID.
function daesinPrintInquiry(response){
  const id=response.RequestID, token=response.ResponseID;
  if(!/^[0-9]+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<1
    ||!['string','number'].includes(typeof token)||String(token).length<1||String(token).length>128)
    throw new Error('출력 응답 번호를 확인하지 못했습니다.');
  return {RequestID:Number(id),ResponseID:String(token),Timeout:30};
}
const DAESIN_PRINT_DIAGNOSTIC='sanghwa-print-diagnostic';
function printDiagnostic(kind){return {version:'0.7.3',generatedAt:new Date().toISOString(),kind,steps:[]};}
function responseFields(response){
  return Object.fromEntries(['Result','RequestID','ResponseID'].filter(key=>response[key]!==undefined).map(key=>[key,response[key]]));
}
async function printerPost(path,body,diagnostic){
  const entry={path,request:path==='/checkStatus'?body:{id:body.id,commandCount:Object.keys(body.functions).length}};
  diagnostic.steps.push(entry);if(diagnostic.steps.length>24)diagnostic.steps.shift();
  try{
    const response=await fetch(DAESIN_PRINTER+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
    entry.httpStatus=response.status;
    const raw=await response.text();
    if(!response.ok)throw new Error('출력 프로그램 응답 '+response.status);
    let data;
    try{data=JSON.parse(raw);}catch{entry.responsePreview=raw.slice(0,200);throw new Error('출력 프로그램 응답을 읽지 못했습니다.');}
    entry.response=responseFields(data);
    return data;
  }catch(error){entry.error=error.message;throw error;}
  finally{await chrome.storage.local.set({[DAESIN_PRINT_DIAGNOSTIC]:diagnostic});}
}
async function waitDaesinPrintResult(initial,diagnostic){
  let response=initial;
  const inquiry=/ready|progress/i.test(String(response.Result))?daesinPrintInquiry(response):null;
  const deadline=Date.now()+60000;
  while(/ready|progress/i.test(String(response.Result))){
    if(Date.now()>deadline)throw new Error('출력 결과 응답 시간이 초과됐습니다.');
    response=await printerPost('/checkStatus',inquiry,diagnostic);
  }
  if(!/^(success|complete|completed|ok)$/i.test(String(response.Result)))throw new Error('출력 프로그램: '+String(response.Result).slice(0,120));
}
async function diagnoseDaesinPrinter(){
  const diagnostic=printDiagnostic('status-only');
  try{
    await probeDaesinPrinter();
    // Fixed status command only: no clearing, drawing, feeding or printBuffer.
    // Never accept diagnostic commands from a caller.
    const id=crypto.getRandomValues(new Uint32Array(1))[0]%2000000000+1;
    const response=await printerPost('',{id,functions:{func0:{checkLabelStatus:[]}}},diagnostic);
    await waitDaesinPrintResult(response,diagnostic);
    diagnostic.passed=true;diagnostic.message='종이 출력 없이 연결·완료 응답 확인을 통과했습니다.';
  }catch(error){diagnostic.passed=false;diagnostic.message='완료 응답 점검 실패 · '+error.message+' · 송장은 보내지 않았습니다.';}
  await chrome.storage.local.set({[DAESIN_PRINT_DIAGNOSTIC]:diagnostic});
  return {ok:true,diagnostic};
}
function normalizeDaesinPrintLabel(label){
  // Carrier freight templates unconditionally draw the absent street address.
  // Empty text has no visible output; omit only those font calls. Preserve all
  // nonempty text, barcodes, coordinates, settings and the final print command.
  const ordered=Object.entries(label.functions).sort(([a],[b])=>Number(a.slice(4))-Number(b.slice(4)));
  const commands=ordered.map(([,command])=>command).filter(command=>{
    const [name,args]=Object.entries(command)[0];
    return !(['drawTrueTypeFont','drawDeviceFont'].includes(name)&&args[0]==='');
  });
  return {id:label.id,functions:Object.fromEntries(commands.map((command,index)=>['func'+index,command]))};
}
async function dispatchDaesinLabels(job){
  if(!/^[a-f0-9-]{36}$/.test(job?.id||'')||!/^\d{12,13}$/.test(job.waybill_no||''))throw new Error('출력 요청을 확인하지 못했습니다.');
  validateDaesinPrintLabels(job.labels,job.waybill_no);
  const labels=job.labels.map(normalizeDaesinPrintLabel);
  validateDaesinPrintLabels(labels,job.waybill_no);
  const key='sanghwaPrint:'+job.id, prior=(await chrome.storage.local.get(key))[key];
  if(prior)return {ok:true,...(prior.state==='sending'?{state:'unknown',message:'이 PC에서 이미 전송을 시도했습니다. 실제 송장을 확인해 주세요.'}:prior)};
  await probeDaesinPrinter();
  let completed=0,stage='송장 전송';
  const diagnostic=printDiagnostic('label-result');
  diagnostic.omittedEmptyText=job.labels.reduce((count,label,index)=>count+Object.keys(label.functions).length-Object.keys(labels[index].functions).length,0);
  const save=async state=>{await chrome.storage.local.set({[key]:state});return {ok:true,...state};};
  // Persist BEFORE the first irreversible local request. No automatic resending.
  await save({state:'sending',message:'프린터로 전송 중',completed:0});
  try{
    for(const ordered of labels){
      stage='송장 전송';
      const response=await printerPost('',ordered,diagnostic);
      stage='출력 완료 확인';
      await waitDaesinPrintResult(response,diagnostic);
      completed++;
      await save({state:'sending',message:'프린터 처리 중',completed});
    }
    return save({state:'sent',message:'프린터 전송 완료 · '+completed+'장',completed});
  }catch(error){return save({state:'unknown',message:'완료 응답 확인 '+completed+'/'+job.labels.length+'장 · '+stage+' 오류: '+error.message+' 실제 송장이 나왔을 수 있습니다. 자동 재출력하지 않습니다.',completed});}
}
async function preparePrintOnCarrier(payload,sourceTab){
  const tabs=(await chrome.tabs.query({url:CARRIER+'/searchSvl*',windowId:sourceTab.windowId})).filter(t=>new URL(t.url).searchParams.get('svcSid')==='dailySearch');
  let tab=tabs[0];
  if(!tab){tab=await chrome.tabs.create({url:DAILY,active:false,windowId:sourceTab.windowId});await waitForTab(tab.id);}
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:prepareDaesinLabels,args:[payload]});
  if(result?.result?.code==='LOGIN_REQUIRED')await chrome.tabs.update(tab.id,{active:true});
  if(result?.result?.error||!result?.result?.labels)throw new Error(result?.result?.error||'송장 데이터를 준비하지 못했습니다.');
  validateDaesinPrintLabels(result.result.labels,payload.waybillNo);
  return {ok:true,labels:result.result.labels};
}
