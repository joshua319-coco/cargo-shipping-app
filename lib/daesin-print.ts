import { supabase } from './supabase';

export type PrintSummary = { id: string; waybillNo: string; state: string; message: string; updatedAt: string };
export type PrintJob = { id: string; token: string; waybill_no: string; labels: unknown[]; snapshot: {receiver: string}; state: string; message: string };
type BridgeReply = {ok: boolean; error?: string; labels?: unknown[]; printStation?: boolean; state?: string; message?: string};
export function printBridge(action: string, extra: Record<string, unknown> = {}): Promise<BridgeReply> {
  return new Promise((resolve, reject) => {
    const requestId=crypto.randomUUID();
    const timeout=setTimeout(() => {window.removeEventListener('message',receive);reject(new Error(action==='print-send'?'출력 응답을 확인하지 못했습니다. 실제 송장을 확인해 주세요. 자동 재출력하지 않습니다.':'연결 도구 0.7.0 이상이 필요합니다. 확장 프로그램과 출고사이트를 새로고침해 주세요.'));},action==='print-send'?300000:action==='print-prepare'?100000:8000);
    function receive(event: MessageEvent){
      if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='sanghwa-live-response'||event.data.requestId!==requestId)return;
      clearTimeout(timeout);window.removeEventListener('message',receive);
      const result=event.data.result as BridgeReply;
      if(!result?.ok)reject(new Error(result?.error||'출력 연결에 실패했습니다.'));else resolve(result);
    }
    window.addEventListener('message',receive);
    window.postMessage({channel:'sanghwa-live-request',requestId,action,...extra},location.origin);
  });
}
export async function requestDaesinPrint(shipmentId:string,checked:boolean,waybillNo:string,receiptDate:string){
  const params={p_shipment_id:Number(shipmentId),p_checked:checked,p_waybill_no:waybillNo};
  const check=await supabase.rpc('daesin_print_request',params);
  if(check.error)throw check.error;
  if(!check.data?.needsPreparation)return check.data;
  const connection=await printBridge('ping');
  if(!connection.printStation)throw new Error('PDA 자동 출력은 연결 도구 0.7.0 이상이 필요합니다. 상세 결과·연결 설정에서 업데이트해 주세요.');
  const prepared=await printBridge('print-prepare',{payload:{waybillNo,receiptDate,snapshot:check.data.snapshot}});
  if(!prepared.labels?.length)throw new Error('송장 데이터가 없습니다.');
  const queued=await supabase.rpc('daesin_print_request',{...params,p_snapshot:check.data.snapshot,p_labels:prepared.labels});
  if(queued.error)throw queued.error;
  return queued.data;
}
export async function printWorker(stationId:string,action:string,job?:PrintJob,result:Record<string,unknown>={}) {
  const response=await supabase.rpc('daesin_print_worker',{p_station_id:stationId,p_action:action,p_job_id:job?.id??null,p_token:job?.token??null,p_result:result});
  if(response.error)throw response.error;
  return response.data as {job?:PrintJob|null;error?:string};
}
export function printStatusLabel(summary?:PrintSummary){
  return summary?({queued:'출력 대기',claimed:'출력 준비',sending:'출력 중',sent:'전송 완료',blocked:'출력 확인',unknown:'출력 확인',cancelled:'출력 취소'}[summary.state]||''):'';
}
