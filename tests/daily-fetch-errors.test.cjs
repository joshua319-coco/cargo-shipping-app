const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function fetchRows(rows, listing = {result:'SUCCESS', resultList:{rows}}){
 const calls=[];
 const context=vm.createContext({URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Uint8Array,btoa,
  location:{href:'https://partner.ds3211.co.kr/searchSvl?svcGid=customer.search&svcSid=dailySearch'},
  document:{querySelector:()=>({querySelector:id=>({value:id==='#selectSearchType'?'1':'2026-10-06'})})},
  FormData:class { *[Symbol.iterator](){yield ['dailyStartDate','2026-10-06'];} },
  fetch:async(url,options)=>{
   calls.push({url,options});
   const data=calls.length===1?listing:{result:'SUCCESS',resultList:{filePath:'/test.xls'}};
   return {ok:true,json:async()=>data,headers:new Map(),arrayBuffer:async()=>Uint8Array.from([1,2,3]).buffer};
  }
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/daesin-registration-test/extension/daily-export.js'),'utf8'),context);
 return {result:JSON.parse(JSON.stringify(await context.fetchDaesinDailyWorkbook('2026-10-06'))),calls};
}
test('blank, malformed and duplicate numbers identify the failing rows before exporting',async()=>{
 const {result,calls}=await fetchRows([{waybill_no:null,arrival_name:'do not record recipient'},{WAYBILL_NO:'999999999991'},{waybill_no:'12345'},{waybill_no:'999999999992'},{waybill_no:'9999-9999-9992'}]);
 assert.equal(calls.length,1);assert.equal(result.workbook,undefined);
 assert.match(result.error,/빈 번호 2행.*번호 형식 오류 1행.*중복 번호 1개/);
 assert.equal(result.diagnosis.rowCount,5);assert.equal(result.diagnosis.invalidCount,3);
 assert.deepEqual(result.diagnosis.invalidSamples.map(x=>x.row),[1,2,3]);
 assert.deepEqual(result.diagnosis.duplicateSamples,[{number:'999999999992',rows:[4,5]}]);
 assert.ok(result.diagnosis.invalidSamples[1].fields.includes('WAYBILL_NO'));
 assert.ok(!JSON.stringify(result.diagnosis).includes('do not record recipient'));
});
test('number normalization stays consistent between export request and reconciliation dataset',async()=>{
 const {result,calls}=await fetchRows([{waybill_no:' 9999-9999-9991 ',arrival_agencycode:'0000'}]);
 assert.equal(result.error,undefined);assert.equal(result.rows[0].waybill_no,'999999999991');
 assert.equal(new URLSearchParams(calls[1].options.body).get('waybillNos'),'999999999991');
 assert.equal(new URLSearchParams(calls[1].options.body).get('downloadFlg'),'Y');
 assert.equal(result.diagnosis.stage,'complete');assert.equal(calls.length,3);
});
test('failed query diagnostics are bounded without dropping the error counts',async()=>{
 const {result,calls}=await fetchRows(Array.from({length:35},()=>({waybill_no:''})));
 assert.equal(calls.length,1);assert.equal(result.diagnosis.blankCount,35);assert.equal(result.diagnosis.invalidSamples.length,10);
});

test('observed 13-digit Daesin numbers pass query and export unchanged',async()=>{
 const numbers=['2140649004964','2140649004963','2140649004962','2140649004961','2140649004960'];
 const {result,calls}=await fetchRows(numbers.map(waybill_no=>({waybill_no})));
 assert.equal(result.error,undefined);assert.deepEqual(result.rows.map(r=>r.waybill_no),numbers);
 assert.equal(new URLSearchParams(calls[1].options.body).get('waybillNos'),numbers.join(','));
 for(const invalid of ['21406490049','21406490049640','2.140649004964e12','214064900496x'])assert.match((await fetchRows([{waybill_no:invalid}])).result.error,/번호 형식 오류/);
});

test('first daily registration accepts the carrier empty-string response without attempting an export',async()=>{
 for (const resultList of ['', {rows:[]}]) {
  const {result,calls}=await fetchRows(undefined,{result:'SUCCESS',message:'',resultList});
  assert.equal(result.error,undefined);assert.deepEqual(result.rows,[]);assert.equal(result.workbook,'');
  assert.equal(result.diagnosis.rowCount,0);assert.equal(calls.length,1);
 }
});

test('failed and unrecognized queries never masquerade as no previous registrations',async()=>{
 for (const listing of [
  {result:'ERROR',message:'로그인이 필요합니다.',resultList:''},
  {result:'ERROR',message:'대신 조회 실패',resultList:{rows:[]}},
  {result:'UNKNOWN',resultList:''}, {resultList:''},
  {result:'SUCCESS'}, {result:'SUCCESS',resultList:null}, {result:'SUCCESS',resultList:{}},
  {result:'SUCCESS',resultList:[]}, {result:'SUCCESS',resultList:false}, {result:'SUCCESS',resultList:0},
  {result:'SUCCESS',resultList:{rows:null}}, {result:'SUCCESS',resultList:{rows:''}},
 ]) {
  const {result,calls}=await fetchRows(undefined,listing);
  assert.ok(result.error,JSON.stringify(listing));assert.equal(result.rows,undefined);assert.equal(result.workbook,undefined);assert.equal(calls.length,1);
 }
});
