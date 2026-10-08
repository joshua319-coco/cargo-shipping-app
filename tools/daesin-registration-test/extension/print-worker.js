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
async function dispatchDaesinLabels(job){
  if(!/^[a-f0-9-]{36}$/.test(job?.id||'')||!/^\d{12,13}$/.test(job.waybill_no||''))throw new Error('출력 요청을 확인하지 못했습니다.');
  validateDaesinPrintLabels(job.labels,job.waybill_no);
  const key='sanghwaPrint:'+job.id, prior=(await chrome.storage.local.get(key))[key];
  if(prior)return {ok:true,...(prior.state==='sending'?{state:'unknown',message:'이 PC에서 이미 전송을 시도했습니다. 실제 송장을 확인해 주세요.'}:prior)};
  await probeDaesinPrinter();
  let completed=0,stage='송장 전송';
  const save=async state=>{await chrome.storage.local.set({[key]:state});return {ok:true,...state};};
  // Persist BEFORE the first irreversible local request. No automatic resending.
  await save({state:'sending',message:'프린터로 전송 중',completed:0});
  try{
    for(const label of job.labels){
      const post=async(url,body)=>{
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
        if(!r.ok)throw new Error('출력 프로그램 응답 '+r.status);
        return r.json();
      };
      // Chrome IPC and Postgres JSONB reorder object keys. Restore native func order.
      const ordered={id:label.id,functions:Object.fromEntries(Object.entries(label.functions).sort(([a],[b])=>Number(a.slice(4))-Number(b.slice(4))))};
      stage='송장 전송';
      let response=await post(DAESIN_PRINTER,ordered);
      // Poll the ORIGINAL handles. Progress replies need not repeat the identifiers.
      const inquiry=/ready|progress/i.test(String(response.Result))?daesinPrintInquiry(response):null;
      const deadline=Date.now()+60000;
      while(/ready|progress/i.test(String(response.Result))){
        if(Date.now()>deadline)throw new Error('출력 결과 응답 시간이 초과됐습니다.');
        stage='출력 완료 확인';
        response=await post(DAESIN_PRINTER+'/checkStatus',inquiry);
      }
      if(!/^(success|complete|completed|ok)$/i.test(String(response.Result)))throw new Error('출력 프로그램: '+String(response.Result).slice(0,120));
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
