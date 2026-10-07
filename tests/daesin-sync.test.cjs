const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
const moduleValue={exports:{}};
const source=fs.readFileSync(path.join(__dirname,'../lib/daesin-sync.ts'),'utf8');
new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(moduleValue.exports,moduleValue);
const {mayRegister,findDaesinCandidate,registrationFromJob,validDaesinDate}=moduleValue.exports;
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
