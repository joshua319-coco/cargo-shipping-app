'use strict';
// Run only on the requesting user's logged-in Daesin page. Capture native label
// commands synchronously; never call that PC's mPrint server.
async function prepareDaesinLabels(expected) {
  const fail = (message,code) => { throw Object.assign(new Error(message),{code}); };
  const login = () => fail('대신 로그인이 필요합니다. 이 컴퓨터에서 대신에 로그인한 뒤 PDA를 다시 체크해 주세요.','LOGIN_REQUIRED');
  try {
    const url=new URL(location.href), form=document.querySelector('#searchForm');
    if(url.origin!=='https://partner.ds3211.co.kr'||url.searchParams.get('svcSid')!=='dailySearch'||!form||typeof window._labelPrint!=='function'||typeof window.requestPrint!=='function')
      return {code:'LOGIN_REQUIRED',error:'대신 로그인이 필요합니다. 이 컴퓨터에서 대신에 로그인한 뒤 PDA를 다시 체크해 주세요.'};
    if(!/^\d{12,13}$/.test(expected.waybillNo)||!/^\d{4}-\d{2}-\d{2}$/.test(expected.receiptDate))fail('등록된 송장번호와 접수일자가 필요합니다.');
    const s=expected.snapshot, qty=Number(s?.qty);
    if(!Number.isInteger(qty)||qty<1||qty>99)fail('자동 출력은 한 건당 1~99박스까지 지원합니다.');
    const text=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
    const phone=v=>String(v??'').replace(/\D/g,'');
    const request=async(path,body)=>{
      const response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'follow',cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams(body),signal:AbortSignal.timeout(30000)});
      if(response.status===401||response.status===403)login();
      if(!response.ok)fail('대신 조회에 실패했습니다. 로그인 상태를 확인해 주세요.');
      const raw=await response.text();
      if(/^\s*</.test(raw))login();
      const data=JSON.parse(raw);
      if(data.result!=='SUCCESS')fail(String(data.message||'대신 조회 결과를 확인하지 못했습니다.'));
      return data.resultList;
    };
    const query=Object.fromEntries(new FormData(form));
    Object.assign(query,{svcGid:'customer.search',svcSid:'selectArticleList',selectSearchType:'1',dailyStartDate:expected.receiptDate,stopoverRoute:''});
    const listing=await request('/searchSvl',query);
    const rows=listing?.rows?.filter(r=>String(r.waybill_no)===expected.waybillNo);
    if(rows?.length!==1)fail('대신에 해당 접수가 없습니다. 전산데이터를 새로고침해 주세요.');
    const r=rows[0];
    const differences=[];
    if(text(r.arrival_name)!==text(s.receiver))differences.push('수화주');
    if(phone(r.arrival_phone_number1)!==phone(s.receiverPhone))differences.push('수화주 전화');
    if(Number(r.quantity)!==qty)differences.push('수량');
    if(Number(r.supply_price)+Number(r.tax_amount)!==Number(s.fare))differences.push('운임');
    if(String(r.transit_mode)!==(s.delivery==='택배'?'2':'1'))differences.push('운송');
    if(String(r.payment_mode)!==(s.pay==='선불'?'1':'2'))differences.push('지불');
    if(!r.arrival_agencycode||r.arrival_agencycode==='0000')differences.push('도착지 미지정');
    if(differences.length)fail(differences.join(' · ')+' 확인이 필요합니다. 전산데이터를 새로고침해 주세요.');
    const data=await request('/searchSvl?svcGid=customer.search&svcSid=selectLabelPrintList',{waybillNos:expected.waybillNo,downloadFlg:'N',sortColumn:'',sortOrder:''});
    if(data?.rows?.length!==1||String(data.rows[0].waybill_no)!==expected.waybillNo||Number(data.rows[0].quantity)!==qty)fail('송장 원본의 번호 또는 수량이 달라 출력을 멈췄습니다.');
    const native=data.rows[0];
    if(text(native.arrival_name)!==text(s.receiver)||phone(native.arrival_phone_number1)!==phone(s.receiverPhone)||text(native.sending_name)!==text(s.sender)||phone(native.sending_phone_number)!==phone(s.senderPhone))fail('송장 원본의 발화주·수화주 정보를 확인해 주세요.');
    if(!native.arrival_agencycode||native.arrival_agencycode==='0000')fail('도착영업소를 먼저 지정해 주세요.');
    if(s.delivery==='정기'&&text(native.arrival_agencyname)!==text(s.branch))fail('송장 원본의 도착영업소를 확인해 주세요.');
    if(s.delivery==='택배'){
      const addr=v=>text(v).replace(/[^\p{L}\p{N}-]/gu,'');
      const variants=[native.arrival_address,native.road_address,String(native.arrival_address||'')+' '+String(native.road_address||'')];
      if(!addr(s.address)||!variants.some(v=>addr(v)===addr(s.address)))fail('송장 원본의 택배 주소를 확인해 주세요. 전산데이터 새로고침에서 주소를 대조할 수 있습니다.');
    }
    const original=window.requestPrint, originalId=window.issueID, labels=[];
    try {
      window.issueID=crypto.getRandomValues(new Uint32Array(1))[0]%2000000000+1;
      window.requestPrint=(printer,raw)=>{if(printer!=='Printer1')fail('대신 프린터 설정이 변경되었습니다.');labels.push(JSON.parse(raw));};
      window._labelPrint(data.rows);
    } finally { window.requestPrint=original; window.issueID=originalId; }
    if(labels.length!==qty)fail('송장 데이터를 모두 준비하지 못했습니다. 실제 출력은 하지 않았습니다.');
    return {labels};
  } catch(error){return {code:error.code,error:error.message||String(error)};}
}

function validateDaesinPrintLabels(labels,waybillNo) {
  if(!/^\d{12,13}$/.test(waybillNo)||!Array.isArray(labels)||labels.length<1||labels.length>99||JSON.stringify(labels).length>2000000)throw new Error('잘못된 송장 출력 데이터입니다.');
  const allowed=new Set(['checkLabelStatus','clearBuffer','setDensity','setOrientation','drawTrueTypeFont','drawDeviceFont','draw1DBarcode','printBuffer']);
  const ids=new Set();
  labels.forEach((label,index)=>{
    if(!Number.isInteger(label.id)||label.id<1||label.id>2147483647||ids.has(label.id))throw new Error('출력 요청 번호가 올바르지 않습니다.');
    ids.add(label.id);
    const funcs=Object.entries(label.functions||{}).sort(([a],[b])=>Number(a.slice(4))-Number(b.slice(4)));
    if(funcs.length<4||funcs.length>150)throw new Error('송장 명령 수가 올바르지 않습니다.');
    let prints=0,barcode=false;
    funcs.forEach(([key,value],i)=>{
      const entries=Object.entries(value||{}), [name,args]=entries[0]||[];
      if(key!=='func'+i||entries.length!==1||!allowed.has(name)||!Array.isArray(args)||args.some(v=>!['string','number','boolean'].includes(typeof v)&&v!==null))throw new Error('지원하지 않는 송장 명령입니다.');
      if(name==='printBuffer'){prints++;if(args.length)throw new Error('송장 복사 수를 변경할 수 없습니다.');}
      if(name==='draw1DBarcode'&&args[0]===waybillNo+String(index+1).padStart(3,'0'))barcode=true;
    });
    if(prints!==1||!barcode||!('printBuffer' in funcs[funcs.length-1][1])||!('checkLabelStatus' in funcs[0][1]))throw new Error('송장 바코드 또는 출력 명령이 올바르지 않습니다.');
  });
  return true;
}
if(typeof module!=='undefined')module.exports={prepareDaesinLabels,validateDaesinPrintLabels};
