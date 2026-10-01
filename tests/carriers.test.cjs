/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');

// 페이지의 실제 계산/변환 함수를 실행한다. Supabase 연결은 만들지 않는다.
function loadTs(file, extra = '') {
  const source = fs.readFileSync(path.join(root, file), 'utf8') + extra;
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const compiledModule = { exports: {} };
  const localRequire = (name) => name === '@/lib/supabase' ? { supabase: {} }
    : name === '@/lib/carriers' ? loadTs('lib/carriers.ts') : name === '@/lib/logen-paste' ? loadTs('lib/logen-paste.ts') : require(name);
  vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename: file })(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const carrier = loadTs('lib/carriers.ts');
const { __test: helpers } = loadTs('app/page.tsx', '\nexports.__test = { normalizeShipment, suggestFareByQty, toTemplateRow, toShipmentDbPayload, parseWaybillUploadRows, buildWaybillVerificationRows, normalizeSharedVerifyState, buildWaybillMessageText, TEMPLATE_HEADERS };');
const shipment = (patch = {}) => helpers.normalizeShipment({
  id: '1', carrier: '로젠', receiver: '테스트수하인', receiver_phone: '01012345678',
  address: '경기도 수원시 테스트로 10 101호', postal_code: '12345', sender: '상화시스템',
  sender_phone: '03180595618', qty: 2, fare: 6600, pay: '선불', delivery: '택배',
  memo: '문 앞에 놓아주세요', created_at: '2026-10-01T00:00:00.000Z', ...patch,
});
const logenRaw = (patch = {}) => ({
  수하인: '테스트수하인', 수하인주소: '경기도 수원시 테스트로 10 101호',
  수하인전화번호: '010-1234-5678', 송하인: '상화시스템', 송하인전화번호: '031-8059-5618',
  박스수량: '2', 택배운임: '6,600', 운임구분: '신용', 베송메세지: '문 앞에 놓아주세요', 운송장번호: '12345678901', ...patch,
});
const pasteHelpers = loadTs('lib/logen-paste.ts');
function logenTsv(patch = {}) {
  const record=logenRaw(patch), cells=Array(41).fill('');
  const mapping={4:'운송장번호',8:'수하인',9:'수하인주소',10:'상세주소',11:'수하인전화번호',13:'박스수량',14:'택배운임',15:'운임구분',19:'베송메세지',24:'송하인',27:'송하인전화번호'};
  for(const [index,key] of Object.entries(mapping)) cells[index]=record[key]??'';
  return cells.map(value=>{const text=String(value);return /[\t\r\n"]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;}).join('\t');
}
const parse = (patch = {}) => pasteHelpers.parseLogenPasteRows(logenTsv(patch))[0];

test('legacy records and histories remain Daesin', () => {
  assert.equal(shipment({ carrier: undefined }).carrier, '대신');
  assert.equal(carrier.normalizeCarrier(null), '대신');
  const state = helpers.normalizeSharedVerifyState({ waybill_upload_rows: [{ id: 'old' }] }, '2026-10-01');
  assert.equal(state.waybill_upload_rows[0].id, 'old');
  assert.deepEqual(state.logen_upload_rows, []);
});
test('Logen integer rates and one Jeju surcharge per shipment', () => {
  for (const [qty, normal, jeju] of [[1,3300,6300],[2,6600,9600],[3,9900,12900],[10,33000,36000]]) {
    assert.equal(carrier.logenFare(qty, '서울특별시'), String(normal));
    assert.equal(carrier.logenFare(qty, '제주특별자치도 제주시'), String(jeju));
    assert.equal(carrier.logenFare(qty, '서귀포시'), String(jeju));
  }
  for (const qty of ['', '0', '-1', '0.5', '1.5', 'abc', 'Infinity']) assert.equal(carrier.logenFare(qty), '');
});
test('Daesin half-box and double Jeju rates are preserved', () => {
  assert.equal(helpers.suggestFareByQty({qty:'0.5',delivery:'정기',pack:'박스'}), '4400');
  assert.equal(helpers.suggestFareByQty({qty:'1',delivery:'택배',pack:'박스',address:'제주시'}), '14300');
  assert.equal(helpers.suggestFareByQty({carrier:'로젠',qty:'2',delivery:'택배',pack:'박스',address:'제주시'}), '9600');
});
test('DB payload forces Logen parcel and calculated fare, rejects fractional boxes', () => {
  const payload=helpers.toShipmentDbPayload(shipment({delivery:'정기',fare:1,address:'제주시'}));
  assert.equal(payload.carrier,'로젠'); assert.equal(payload.delivery,'택배'); assert.equal(payload.fare,9600);
  assert.throws(()=>helpers.toShipmentDbPayload(shipment({qty:0.5})), /정수/);
});
test('combined/all exports and wrong-carrier selections are rejected', () => {
  assert.equal(carrier.exportCarrier('전체',[shipment()]),null);
  assert.equal(carrier.exportCarrier('대신',[shipment()]),null);
  assert.equal(carrier.exportCarrier('로젠',[shipment(),shipment({carrier:'대신'})]),null);
  assert.equal(carrier.exportCarrier('로젠',[shipment()]),'로젠');
  assert.equal(carrier.exportCarrier('대신',[{carrier:undefined}]),'대신');
});
test('Excel schema is unchanged; prepaid labels are carrier-specific', () => {
  const logen=helpers.toTemplateRow(shipment(),()=> '12345');
  const daesin=helpers.toTemplateRow(shipment({carrier:'대신'}),()=> '12345');
  assert.deepEqual(Object.keys(logen),helpers.TEMPLATE_HEADERS);
  assert.equal(logen.운임구분,'신용'); assert.equal(daesin.운임구분,'현불');
  assert.equal(helpers.toTemplateRow(shipment({pay:'착불'}),()=> '12345').운임구분,'착불');
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([logen]),'일괄업로드');
  const read=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const row=XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]])[0];
  assert.equal(row.운임구분,'신용'); assert.equal(row.수량,2); assert.equal(row.총운임,6600);
});
test('Logen pasted columns match requested fields and phone formatting', () => {
  const rows=helpers.buildWaybillVerificationRows([shipment()],[parse()]);
  assert.equal(rows.length,1); assert.equal(rows[0].status,'일치');
  assert.match(rows[0].waybillMessage,/로젠택배/); assert.doesNotMatch(rows[0].waybillMessage,/대신/);
  assert.equal(carrier.sameCarrierPhone('01012345678','1012345678'),true);
});
test('each requested Logen field independently triggers a mismatch, including blank phones', () => {
  const cases=[
    [{수하인:'다른이름'},'수하인 이름'], [{수하인주소:'경기도 수원시 테스트로 10'},'주소'],
    [{수하인전화번호:''},'수하인 전화번호'],[{송하인:'다른회사'},'송하인 이름'],
    [{송하인전화번호:''},'송하인 전화번호'],[{박스수량:2.5},'박스수량'],
    [{택배운임:6601},'택배운임'],[{운임구분:'착불'},'운임구분'],[{베송메세지:''},'배송메세지'],
    [{운임구분:''},'운임구분'],
  ];
  for(const [patch,reason] of cases) {
    const result=helpers.buildWaybillVerificationRows([shipment()],[parse(patch)])[0];
    assert.equal(result.status,'확인필요',reason);
    assert.ok(result.reasons.some(x=>x.includes(reason)), reason);
  }
});
test('same customer across carriers never borrows the other waybill', () => {
  const daesin={...parse(),id:'daesin-upload',carrier:'대신',waybillNo:'99999999999'};
  const onlyOther=helpers.buildWaybillVerificationRows([shipment()],[daesin]);
  assert.deepEqual(onlyOther.map(x=>x.status),['출고목록만','발송데이터만']);
  const both=helpers.buildWaybillVerificationRows([shipment(),shipment({id:'2',carrier:'대신'})],[daesin,parse()]);
  assert.equal(both.find(x=>x.shipmentId==='1').waybillNo,'12345678901');
  assert.equal(both.find(x=>x.shipmentId==='2').waybillNo,'99999999999');
});
test('shared upload states retain both carriers independently', () => {
  const state=helpers.normalizeSharedVerifyState({waybill_upload_rows:[{id:'old'}],waybill_upload_file_name:'daesin.xls',logen_upload_rows:[parse()],logen_paste_text:logenTsv()},'2026-10-01');
  assert.equal(state.waybill_upload_rows.length,1); assert.equal(state.logen_upload_rows.length,1);
  assert.equal(state.logen_upload_rows[0].carrier,'로젠');
  assert.equal(state.logen_paste_text,logenTsv());
  assert.equal(state.waybill_upload_file_name,'daesin.xls');
});

test('same-recipient Logen shipments match messages even when upload order reverses', () => {
  const first=shipment({id:'first',memo:'첫 번째 배송'});
  const second=shipment({id:'second',memo:'두 번째 배송'});
  const uploadFirst={...parse({베송메세지:'첫 번째 배송'}),id:'upload-first',waybillNo:'111'};
  const uploadSecond={...parse({베송메세지:'두 번째 배송'}),id:'upload-second',waybillNo:'222'};
  const rows=helpers.buildWaybillVerificationRows([first,second],[uploadSecond,uploadFirst]);
  assert.ok(rows.every(row=>row.status==='일치'));
  assert.equal(rows.find(row=>row.shipmentId==='first').waybillNo,'111');
  assert.equal(rows.find(row=>row.shipmentId==='second').waybillNo,'222');
});

test('clipboard mapping combines J and K while preserving blank intermediate cells', () => {
  const row=parse({수하인주소:'서울특별시 테스트로 10',상세주소:'101동 202호'});
  assert.equal(row.address,'서울특별시 테스트로 10 101동 202호');
  assert.equal(row.waybillNo,'12345678901');assert.equal(row.senderPhone,'031-8059-5618');
  assert.equal(row.receiverPhone,'010-1234-5678');assert.equal(row.memo,'문 앞에 놓아주세요');
});
test('clipboard handles multiple rows, CRLF, quotes and multiline delivery messages', () => {
  const rows=pasteHelpers.parseLogenPasteRows(logenTsv({베송메세지:'첫 줄\n"둘째 줄"\t메모'})+'\r\n'+logenTsv({수하인:'두번째'}));
  assert.equal(rows.length,2);assert.equal(rows[0].memo,'첫 줄\n"둘째 줄"\t메모');assert.equal(rows[1].receiver,'두번째');
});
test('clipboard accepts headers but rejects incomplete rows without dropping columns', () => {
  const header=Array(41).fill('');header[4]='운송장번호';
  assert.equal(pasteHelpers.parseLogenPasteRows(header.join('\t')+'\n'+logenTsv()).length,1);
  assert.throws(()=>pasteHelpers.parseLogenPasteRows('short\trow'),/열이 부족/);
  assert.throws(()=>pasteHelpers.parseLogenPasteRows('"unfinished'),/따옴표/);
});
test('clipboard fare mismatches remain visible instead of being overwritten', () => {
  const row=helpers.buildWaybillVerificationRows([shipment({qty:1,fare:3300})],[parse({박스수량:1,택배운임:3500})])[0];
  assert.equal(row.status,'확인필요');assert.ok(row.reasons.includes('택배운임 확인'));
  assert.equal(row.fareText,'3,300 / 3,500');
});
