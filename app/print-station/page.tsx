'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { printBridge, printWorker } from '@/lib/daesin-print';
import type { PrintJob, PrintDiagnostic } from '@/lib/daesin-print';

const enabledKey='sanghwa-print-station-enabled',idKey='sanghwa-print-station-id';
const messageOf=(error:unknown)=>error instanceof Error?error.message:String((error as {message?:string})?.message||error);
export default function PrintStation(){
  const [signedIn,setSignedIn]=useState(false),[ready,setReady]=useState(false),[enabled,setEnabled]=useState(false);
  const [message,setMessage]=useState('프린터가 연결된 PC에서만 시작해 주세요.'),[current,setCurrent]=useState(''),[history,setHistory]=useState<PrintJob[]>([]);
  const stationId=useRef(''),running=useRef(false),diagnosing=useRef(false);
  const [checking,setChecking]=useState(false),[version,setVersion]=useState(''),[diagnostic,setDiagnostic]=useState<PrintDiagnostic|null>(null);
  const diagnosticSummary=useCallback(async()=>{const result=await printBridge('print-diagnostics');setDiagnostic(result.diagnostic||null);},[]);
  const checkConnection=useCallback(async()=>{
    const ping=await printBridge('ping');setVersion(ping.version||'');
    if(!ping.printStation||ping.printProtocol!==3)throw new Error('프린터 PC의 연결 도구를 0.7.2로 업데이트하고 이 화면을 새로고침해 주세요.');
    const result=await printBridge('print-diagnose');setDiagnostic(result.diagnostic||null);
    if(!result.diagnostic?.passed)throw new Error(result.diagnostic?.message||'완료 응답을 확인하지 못했습니다.');
    return result.diagnostic.message||'연결 점검 완료';
  },[]);
  const diagnose=async()=>{
    if(diagnosing.current||running.current||enabled)return;
    diagnosing.current=true;setChecking(true);
    try{await navigator.locks.request('sanghwa-daesin-printer',{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('다른 출력 화면을 먼저 멈춰 주세요.');
      setMessage('종이 출력 없이 연결·완료 응답을 확인하고 있습니다.');setMessage(await checkConnection());
    });}catch(error){setMessage(messageOf(error));}
    finally{diagnosing.current=false;setChecking(false);}
  };
  const saveDiagnostic=()=>{
    if(!diagnostic)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='대신_프린터_응답점검.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  useEffect(()=>{
    stationId.current=localStorage.getItem(idKey)||crypto.randomUUID();localStorage.setItem(idKey,stationId.current);
    void supabase.auth.getSession().then(({data})=>{setSignedIn(Boolean(data.session));setReady(true);if(data.session&&localStorage.getItem(enabledKey)==='true')setEnabled(true);});
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{setSignedIn(Boolean(session));if(!session)setEnabled(false);});
    return()=>data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    if(!signedIn)return;
    let alive=true;
    const refresh=async()=>{const {data,error}=await supabase.from('daesin_print_jobs').select('id,state,message,snapshot,waybill_no').order('updated_at',{ascending:false}).limit(12);if(alive&&!error)setHistory((data||[]) as PrintJob[]);};
    void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{alive=false;clearInterval(timer);};
  },[signedIn]);
  useEffect(()=>{
    if(!enabled||!signedIn)return;
    let alive=true,heartbeat:ReturnType<typeof setInterval>|undefined;
    const run=async()=>{
      if(!navigator.locks){setMessage('최신 크롬에서 열어 주세요.');setEnabled(false);return;}
      await navigator.locks.request('sanghwa-daesin-printer',{ifAvailable:true},async lock=>{
        if(!lock){setMessage('이 PC의 다른 출력 화면이 이미 실행 중입니다.');setEnabled(false);return;}
        try{
          setMessage('종이 출력 없이 완료 응답을 점검하고 있습니다.');
          await checkConnection();
          await printWorker(stationId.current,'heartbeat');
          heartbeat=setInterval(()=>{void printWorker(stationId.current,'heartbeat').catch(error=>{setMessage(messageOf(error));alive=false;setEnabled(false);});},20000);
          running.current=true;
          while(alive){
            await printBridge('print-probe');
            const claimed=await printWorker(stationId.current,'claim'),job=claimed.job;
            if(job){
              setCurrent(job.snapshot.receiver+' · '+job.waybill_no);setMessage('송장을 프린터로 보내고 있습니다.');
              // Recheck shared source/checkbox/receipt immediately before irreversible dispatch.
              const authorized=await printWorker(stationId.current,'sending',job);
              if(authorized.job?.state==='sending'){
                let result:{state:string;message:string};
                try{const reply=await printBridge('print-send',{job:authorized.job});result={state:reply.state||'unknown',message:reply.message||'출력 결과 확인 필요'};}
                catch(error){result={state:'unknown',message:messageOf(error)};}
                await printWorker(stationId.current,'finish',job,result);
                setMessage(result.message);
                if(result.state==='unknown')await diagnosticSummary().catch(()=>{});
                if(result.state==='unknown')throw new Error(result.message+' 확인 후 자동 출력을 다시 시작해 주세요.');
              }else setMessage(authorized.error||'출력 요청을 확인해 주세요.');
              setCurrent('');
            }else setMessage(claimed.error||'연결됨 · 각 자리에서 PDA를 체크하면 여기서 자동으로 출력합니다.');
            await new Promise(resolve=>setTimeout(resolve,2500));
          }
        }catch(error){setMessage('자동 출력 일시정지 · '+messageOf(error));setCurrent('');setEnabled(false);localStorage.removeItem(enabledKey);}
        finally{running.current=false;if(heartbeat)clearInterval(heartbeat);void printWorker(stationId.current,'stop').catch(()=>{});}
      });
    };
    void run();
    return()=>{alive=false;};
  },[enabled,signedIn,checkConnection,diagnosticSummary]);
  const start=()=>{localStorage.setItem(enabledKey,'true');setEnabled(true);};
  const stop=()=>{localStorage.removeItem(enabledKey);setEnabled(false);setMessage(running.current?'진행 중인 요청 처리 후 멈춥니다.':'출력을 멈췄습니다.');};
  return <main style={{maxWidth:840,margin:'40px auto',padding:28,fontFamily:'Arial,Malgun Gothic,sans-serif',color:'#172033'}}>
    <h1 style={{fontSize:25}}>대신 공용 프린터</h1>
    <p>프린터가 연결된 빈자리 PC에서 이 화면을 켜 두세요. <strong>이 PC의 대신택배 로그인은 필요 없습니다.</strong></p>
    <p style={{color:'#64748b',fontSize:14}}>각 자리에서 준비한 송장을 순서대로 출력합니다. 프린터 PC·크롬·기존 대신 출력 프로그램은 켜 두고, 절전 상태가 되지 않도록 해 주세요.</p>
    {!ready?<p>로그인 확인 중…</p>:!signedIn?<p><Link href="/">출고사이트에 먼저 로그인</Link>한 뒤 이 화면으로 돌아와 주세요.</p>:<>
      <section style={{background:'#f3f7ff',border:'1px solid #dbe5f7',borderRadius:12,padding:20,margin:'24px 0'}}>
        <button type="button" onClick={enabled?stop:start} disabled={checking} style={{border:0,borderRadius:9,padding:'12px 18px',background:enabled?'#e2e8f0':'#2563eb',color:enabled?'#172033':'white',fontWeight:700}}>{enabled?'자동 출력 멈추기':'이 PC에서 자동 출력 시작'}</button>
        <p role="status">{message}</p>{current&&<p>{current}</p>}
        <div style={{display:'flex',gap:10,alignItems:'center',marginTop:12}}><button type="button" disabled={enabled||checking} onClick={()=>void diagnose()} style={{border:'1px solid #cbd5e1',borderRadius:7,padding:'7px 10px',background:'white'}}>{checking?'점검 중…':'출력 없이 연결 점검'}</button>{version&&<small>연결 도구 {version}</small>}</div>
        {diagnostic&&<details open={diagnostic.passed===false} style={{marginTop:10,fontSize:13}}><summary>프린터 응답 기록</summary><button type="button" onClick={saveDiagnostic}>점검결과 파일 저장</button><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:280,overflow:'auto'}}>{JSON.stringify(diagnostic,null,2)}</pre></details>}
      </section>
      <h2 style={{fontSize:18}}>최근 출력 요청</h2>
      {history.length===0?<p>아직 출력 요청이 없습니다.</p>:<ul style={{paddingLeft:20}}>{history.map(job=><li key={job.id} style={{marginBottom:14}}><strong>{job.snapshot.receiver}</strong> · {job.waybill_no}<br/><span style={{fontSize:14,color:job.state==='unknown'||job.state==='blocked'?'#c2410c':'#64748b'}}>{job.message}</span></li>)}</ul>}
    </>}
    <p style={{fontSize:13,color:'#64748b'}}>‘전송 완료’는 출력 프로그램의 성공 응답입니다. 용지 부족 등으로 종이가 나오지 않으면 실제 프린터를 확인해 주세요. 결과가 불확실한 요청은 자동 재출력하지 않습니다.</p>
    <p><Link href="/registration-test-setup/index.html">연결 도구 설치·업데이트</Link> · <Link href="/">출고사이트</Link></p>
  </main>;
}
