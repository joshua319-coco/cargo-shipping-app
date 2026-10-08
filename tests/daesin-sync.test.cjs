const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
const moduleValue={exports:{}};
const source=fs.readFileSync(path.join(__dirname,'../lib/daesin-sync.ts'),'utf8');
new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(moduleValue.exports,moduleValue);
const {daesinRegistrationView,mayRegister,findDaesinCandidate,registrationFromJob,validDaesinDate}=moduleValue.exports;
const shipment=(patch={})=>({id:'1',carrier:'대신',shipmentDate:'2026-10-07',receiver:'예시업체',receiverPhone:'01011112222',qty:'1',fare:'6600',delivery:'택배',pay:'착불',...patch});
const row=(patch={})=>({waybill_no:'9999999999991',arrival_name:'예시업체',arrival_phone_number1:'010-1111-2222',arrival_agencycode:'2401',quantity:'1',supply_price:'6000',tax_amount:'600',transit_mode:'2',payment_mode:'2',...patch});
test('only new shipments or explicitly corrected definite failures can register',()=>{
 assert.equal(mayRegister(undefined,'new',false),true);
 for(const state of ['registered','pending','unknown'])assert.equal(mayRegister({state,fingerprint:'old'},'new',true),false);
 assert.equal(mayRegister({state:'not-registered',fingerprint:'old'},'old',true),false);
 assert.equal(mayRegister({state:'not-registered',fingerprint:'old'},'new',false),false);
 assert.equal(mayRegister({state:'not-registered',fingerprint:'old'},'new',true),true);
});
test('existing manual receipt requires unique identity and matching source fields',()=>{
 const source=shipment();assert.equal(findDaesinCandidate(source,[row()],[source]).row.waybill_no,row().waybill_no);
 for(const patch of [{quantity:'2'},{tax_amount:'700'},{payment_mode:'1'},{transit_mode:'1'}]){const result=findDaesinCandidate(source,[row(patch)],[source]);assert.equal(result.possible,true);assert.equal(result.row,undefined);}
 assert.equal(findDaesinCandidate(source,[row(),row({waybill_no:'9999999999992'})],[source]).row,undefined);
 assert.equal(findDaesinCandidate(source,[row()],[source,shipment({id:'2'})]).row,undefined);
 assert.equal(findDaesinCandidate(source,[row()],[source,shipment({id:'2',carrier:'로젠'})]).row.waybill_no,row().waybill_no);
 const owned=shipment({id:'2',receiver:'다른업체',daesinRegistration:{waybillNo:row().waybill_no}});
 assert.equal(findDaesinCandidate(source,[row()],[source,owned]).row,undefined);
});
test('known number remains identity after quantity/fare/name edits; missing receipt never becomes new',()=>{
 const source=shipment({receiver:'수정업체',qty:'3',fare:'19800',daesinRegistration:{waybillNo:row().waybill_no}});
 assert.equal(findDaesinCandidate(source,[row()],[source]).row.waybill_no,row().waybill_no);
 assert.deepEqual(findDaesinCandidate(source,[],[source]),{row:undefined,possible:true});
});
test('success without number stays registered, uncertain and prohibited remain distinct',()=>{
 const job={id:'attempt',shipmentDate:'2026-10-07',numbers:[],message:'',state:'registered-awaiting-number',registered:true};
 assert.equal(registrationFromJob(job).state,'registered');
 assert.equal(registrationFromJob({...job,registered:false,state:'not-registered'}).state,'not-registered');
 assert.equal(registrationFromJob({...job,registered:false,state:'needs-review'}).state,'unknown');
 assert.equal(registrationFromJob({...job,registered:false,state:'submitting'}).state,'pending');
 assert.equal(registrationFromJob({...job,numbers:[row().waybill_no]}).waybillNo,row().waybill_no);
});
test('registration and refresh accept real calendar dates beyond the old test day',()=>{
 for(const date of ['2026-10-07','2026-10-08','2028-02-29'])assert.equal(validDaesinDate(date),true);
 for(const date of ['2026-02-29','2026-13-01','2026-2-1',''])assert.equal(validDaesinDate(date),false);
});

test('registration badges distinguish unregistered, verified, destination review and uncertainty',()=>{
 const verified={waybillNo:row().waybill_no,status:'일치',reasons:[]};
 const state={state:'registered',waybillNo:row().waybill_no};
 assert.equal(daesinRegistrationView().label,'미등록');
 assert.equal(daesinRegistrationView(undefined,verified).label,'등록완료','manual Excel confirmation counts');
 assert.equal(daesinRegistrationView(state,verified).label,'등록완료');
 assert.equal(daesinRegistrationView(state).label,'정보확인','registration without the latest data must not imply verification');
 const destination=daesinRegistrationView({...state,destinationNeedsReview:true,destinationReason:'공동관할구역'},verified);
 assert.equal(destination.label,'정보확인');assert.equal(destination.registered,true);assert.match(destination.reasons[0],/공동관할구역.*마감관리/);
 for(const pending of ['unknown','pending']) {const v=daesinRegistrationView({state:pending,message:'접수 응답 확인 필요'});assert.equal(v.label,'정보확인');assert.equal(v.registered,false);}
 const rejected=daesinRegistrationView({state:'not-registered',message:'택배,정기불가'});assert.equal(rejected.label,'미등록');assert.deepEqual(rejected.reasons,['택배,정기불가']);
});
test('registered discrepancy details survive source edits and clear after matching refresh',()=>{
 const state={state:'registered',waybillNo:row().waybill_no};
 const info={waybillNo:row().waybill_no,status:'확인필요',reasons:['수량 확인','총운임 확인']};
 const v=daesinRegistrationView(state,info);assert.equal(v.label,'정보확인');assert.equal(v.registered,true);assert.deepEqual(v.reasons,info.reasons);assert.equal(v.waybillNo,state.waybillNo);
 assert.equal(mayRegister(state,'changed',true),false);
 assert.equal(daesinRegistrationView(state,{...info,status:'일치',reasons:[]}).label,'등록완료');
});

test('missing carrier receipt hides active number but preserves the audit and blocks ordinary sync',()=>{
 const saved={state:'registered',waybillNo:row().waybill_no,carrierMissing:true};
 const view=daesinRegistrationView(saved,{waybillNo:row().waybill_no,status:'일치',reasons:[]});
 assert.equal(view.label,'정보확인');assert.equal(view.waybillNo,'');assert.match(view.reasons[0],/기존 접수를 찾지/);
 assert.equal(saved.waybillNo,row().waybill_no);assert.equal(mayRegister(saved,'changed',true),false);
 assert.equal(daesinRegistrationView({...saved,carrierMissing:false},{waybillNo:row().waybill_no,status:'일치',reasons:[]}).label,'등록완료');
});
test('retired cached number cannot make a new attempt registered, and reappearing old carrier row blocks automatic registration',()=>{
 const state={state:'pending',waybillNo:'',retiredWaybills:[row().waybill_no]};
 assert.equal(daesinRegistrationView(state,{waybillNo:row().waybill_no,status:'일치',reasons:[]}).waybillNo,'');
 const source=shipment({daesinRegistration:state});assert.deepEqual(findDaesinCandidate(source,[row()],[source]),{row:undefined,possible:true});
});
test('deletion confirmation checks both original and edited recipient identities and the old waybill',()=>{
 const conflict=moduleValue.exports.deletedDaesinConflict,previous={waybillNo:row().waybill_no,snapshot:{receiver:'예시업체',receiver_phone:'01011112222'}};
 const edited=shipment({receiver:'새 업체',receiverPhone:'01022223333'});
 assert.equal(conflict(edited,[],previous),false);
 assert.equal(conflict(edited,[row({arrival_name:'다른이름',arrival_phone_number1:'01099999999'})],previous),true);
 assert.equal(conflict(edited,[row({waybill_no:'9999999999992'})],previous),true);
 assert.equal(conflict(edited,[row({waybill_no:'9999999999992',arrival_name:'새 업체',arrival_phone_number1:'01022223333'})],previous),true);
});

test('confirmed deletion stays unregistered until a separate sync, even with identical source data',()=>{
 const state={state:'not-registered',deletionConfirmed:true,fingerprint:'same',waybillNo:'',retiredWaybills:[row().waybill_no],message:'미등록으로 변경했습니다.'};
 assert.equal(daesinRegistrationView(state,{waybillNo:row().waybill_no,status:'일치',reasons:[]}).label,'미등록');
 assert.equal(mayRegister(state,'same',true),true);
 assert.equal(mayRegister({...state,deletionConfirmed:false},'same',true),false);
 for(const status of ['registered','pending','unknown'])assert.equal(mayRegister({...state,state:status},'same',true),false);
});

test('deletion-confirmed and pending replacement rows never borrow another customer cached verification',()=>{
 const state={state:'not-registered',deletionConfirmed:true,waybillNo:'',retiredWaybills:[row().waybill_no]};
 const unrelated={waybillNo:'9999999999999',status:'확인필요',reasons:['수화주명 확인']};
 assert.equal(daesinRegistrationView(state,unrelated).label,'미등록');assert.equal(daesinRegistrationView(state,unrelated).waybillNo,'');
 assert.equal(daesinRegistrationView({...state,state:'pending'},unrelated).waybillNo,'');
});
