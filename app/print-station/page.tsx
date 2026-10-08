'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { printBridge, printWorker } from '@/lib/daesin-print';
import type { PrintJob } from '@/lib/daesin-print';

const enabledKey='sanghwa-print-station-enabled',idKey='sanghwa-print-station-id';
const messageOf=(error:unknown)=>error instanceof Error?error.message:String((error as {message?:string})?.message||error);
export default function PrintStation(){
  const [signedIn,setSignedIn]=useState(false),[ready,setReady]=useState(false),[enabled,setEnabled]=useState(false);
  const [message,setMessage]=useState('프린터가 연결된 PC에서만 시작해 주세요.'),[current,setCurrent]=useState(''),[history,setHistory]=useState<PrintJob[]>([]);
  const stationId=useRef(''),running=useRef(false);
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
          const ping=await printBridge('ping');if(!ping.printStation)throw new Error('연결 도구 0.7.0 이상을 설치하고 이 화면을 새로고침해 주세요.');
          await printBridge('print-probe');
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
                if(result.state==='unknown')throw new Error(result.message+' 확인 후 자동 출력을 다시 시작해 주세요.');
              }else setMessage(authorized.error||'출력 요청을 확인해 주세요.');
              setCurrent('');
            }else setMessage(claimed.error||'연결됨 · 각 자리에서 PDA를 체크하면 여기서 자동으로 출력합니다.');
            await new Promise(resolve=>setTimeout(resolve,2500));
          }
        }catch(error){setMessage(messageOf(error));setEnabled(false);localStorage.removeItem(enabledKey);}
        finally{running.current=false;if(heartbeat)clearInterval(heartbeat);void printWorker(stationId.current,'stop').catch(()=>{});}
      });
    };
    void run();
    return()=>{alive=false;};
  },[enabled,signedIn]);
  const start=()=>{localStorage.setItem(enabledKey,'true');setEnabled(true);};
  const stop=()=>{localStorage.removeItem(enabledKey);setEnabled(false);setMessage(running.current?'진행 중인 요청 처리 후 멈춥니다.':'출력을 멈췄습니다.');};
  return <main style={{maxWidth:840,margin:'40px auto',padding:28,fontFamily:'Arial,Malgun Gothic,sans-serif',color:'#172033'}}>
    <h1 style={{fontSize:25}}>대신 공용 프린터</h1>
    <p>프린터가 연결된 빈자리 PC에서 이 화면을 켜 두세요. <strong>이 PC의 대신택배 로그인은 필요 없습니다.</strong></p>
    <p style={{color:'#64748b',fontSize:14}}>각 자리에서 준비한 송장을 순서대로 출력합니다. 프린터 PC·크롬·기존 대신 출력 프로그램은 켜 두고, 절전 상태가 되지 않도록 해 주세요.</p>
    {!ready?<p>로그인 확인 중…</p>:!signedIn?<p><Link href="/">출고사이트에 먼저 로그인</Link>한 뒤 이 화면으로 돌아와 주세요.</p>:<>
      <section style={{background:'#f3f7ff',border:'1px solid #dbe5f7',borderRadius:12,padding:20,margin:'24px 0'}}>
        <button type="button" onClick={enabled?stop:start} style={{border:0,borderRadius:9,padding:'12px 18px',background:enabled?'#e2e8f0':'#2563eb',color:enabled?'#172033':'white',fontWeight:700}}>{enabled?'자동 출력 멈추기':'이 PC에서 자동 출력 시작'}</button>
        <p role="status">{message}</p>{current&&<p>{current}</p>}
      </section>
      <h2 style={{fontSize:18}}>최근 출력 요청</h2>
      {history.length===0?<p>아직 출력 요청이 없습니다.</p>:<ul style={{paddingLeft:20}}>{history.map(job=><li key={job.id} style={{marginBottom:14}}><strong>{job.snapshot.receiver}</strong> · {job.waybill_no}<br/><span style={{fontSize:14,color:job.state==='unknown'||job.state==='blocked'?'#c2410c':'#64748b'}}>{job.message}</span></li>)}</ul>}
    </>}
    <p style={{fontSize:13,color:'#64748b'}}>‘전송 완료’는 출력 프로그램의 성공 응답입니다. 용지 부족 등으로 종이가 나오지 않으면 실제 프린터를 확인해 주세요. 결과가 불확실한 요청은 자동 재출력하지 않습니다.</p>
    <p><Link href="/registration-test-setup/index.html">연결 도구 설치·업데이트</Link> · <Link href="/">출고사이트</Link></p>
  </main>;
}
