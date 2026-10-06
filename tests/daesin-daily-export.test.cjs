const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({});
for(const f of ['registration-policy.js','daily-export.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/daesin-registration-test/extension',f),'utf8'),context);
const reconcile=context.reconcileDaesinDailyJobs;
const date='2026-10-06';
const job=()=>({shipmentDate:date,receiver:'테스트수화주',state:'registered-awaiting-number',numbers:[],destinationNeedsReview:true,diagnosis:{source:{quantity:1,fare:4400,delivery:'정기',pay:'선불',receiverPhone:'01012345678'},upload:{rowCount:1},registration:{result:'SUCCESS'}}});
const row=()=>({waybill_no:'999999999991',arrival_name:'테스트수화주',arrival_phone_number1:'010-1234-5678',quantity:'1',supply_price:'4000',tax_amount:'400',transit_mode:'1',payment_mode:'1',arrival_agencycode:'2401'});
test('structured daily response connects prepaid freight and refreshes destination correction state',()=>{
 const j=job();reconcile([j],[row()],date);assert.equal(j.numbers[0],'999999999991');assert.equal(j.state,'verified');assert.equal(j.destinationNeedsReview,false);
 const pending=job();reconcile([pending],[{...row(),arrival_agencycode:'0000'}],date);assert.equal(pending.numbers[0],'999999999991');assert.equal(pending.destinationNeedsReview,true);
});
test('ambiguous names or any differing identity/amount/service never overwrite a job number',()=>{
 for(const change of [{arrival_name:'테스트수화주0'},{arrival_phone_number1:'01099999999'},{quantity:'2'},{tax_amount:'500'},{transit_mode:'2'},{payment_mode:'2'}]){const j=job();reconcile([j],[{...row(),...change}],date);assert.equal(j.numbers.length,0);}
 const duplicate=job();reconcile([duplicate],[row(),{...row(),waybill_no:'999999999992'}],date);assert.equal(duplicate.numbers.length,0);
 const prior=job();prior.numbers=['999999999993'];reconcile([prior],[row()],date);assert.equal(prior.numbers[0],'999999999993');
 const differentDay=job();reconcile([differentDay],[row()],'2026-10-05');assert.equal(differentDay.numbers.length,0);
 const unknown=job();unknown.diagnosis.registration.result='ERROR';reconcile([unknown],[row()],date);assert.equal(unknown.numbers.length,0);
});
