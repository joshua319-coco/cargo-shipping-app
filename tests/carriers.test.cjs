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
    : name === '@/lib/carriers' ? loadTs('lib/carriers.ts') : name === '@/lib/logen-paste' ? loadTs('lib/logen-paste.ts') : name === './daesin-sync' || name === '@/lib/daesin-sync' ? loadTs('lib/daesin-sync.ts') : name === '@/lib/registration-status' ? loadTs('lib/registration-status.ts') : require(name);
  vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename: file })(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const carrier = loadTs('lib/carriers.ts');
const { __test: helpers } = loadTs('app/page.tsx', '\nexports.__test = { normalizeShipment, suggestFareByQty, jejuShipmentNotice, shipmentRegistrationView, toTemplateRow, toShipmentDbPayload, parseWaybillUploadRows, buildWaybillVerificationRows, normalizeSharedVerifyState, buildWaybillMessageText, TEMPLATE_HEADERS, toLogenTemplateRow, LOGEN_TEMPLATE_HEADERS, isValidShipmentDate, isLiveDaesinTestShipment, validateDaesinDailyImport };');
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
test('Logen prepaid/collect base rates exclude the manual Jeju surcharge', () => {
  for (const [pay, unit] of [['선불',3300],['착불',3500]]) {
    for (const qty of [1,2,3,10]) {
      assert.equal(carrier.logenFare(qty, '서울특별시', pay), String(qty * unit));
      for (const address of ['제주특별자치도 제주시','서귀포시']) {
        assert.equal(carrier.logenFare(qty, address, pay), String(qty * unit));
        assert.equal(helpers.suggestFareByQty({carrier:'로젠',pay,qty:String(qty),delivery:'택배',pack:'박스',address}), String(qty * unit));
      }
    }
    for (const qty of ['', '0', '-1', '0.5', '1.5', 'abc', 'Infinity']) assert.equal(carrier.logenFare(qty, '', pay), '');
  }
  assert.equal(carrier.logenFare(1), '3500');
  assert.equal(helpers.suggestFareByQty({carrier:'로젠',qty:'1',delivery:'택배',pack:'박스'}), '3500');
});
test('Daesin half-box and double Jeju rates are preserved', () => {
  assert.equal(helpers.suggestFareByQty({qty:'0.5',delivery:'정기',pack:'박스'}), '4400');
  assert.equal(helpers.suggestFareByQty({qty:'1',delivery:'택배',pack:'박스',address:'제주시'}), '14300');
  assert.equal(helpers.suggestFareByQty({carrier:'로젠',pay:'선불',qty:'2',delivery:'택배',pack:'박스',address:'제주시'}), '6600');
});
test('DB payload keeps manually entered Logen fare and still enforces integer parcel boxes', () => {
  const payload=helpers.toShipmentDbPayload(shipment({delivery:'정기',fare:'7,200',address:'제주시'}));
  assert.equal(payload.carrier,'로젠'); assert.equal(payload.delivery,'택배'); assert.equal(payload.fare,7200);
  assert.equal(helpers.toLogenTemplateRow(shipment({fare:payload.fare})).총운임,7200);
  assert.throws(()=>helpers.toShipmentDbPayload(shipment({qty:0.5})), /정수/);
});
test('combined/all exports and wrong-carrier selections are rejected', () => {
  assert.equal(carrier.exportCarrier('전체',[shipment()]),null);
  assert.equal(carrier.exportCarrier('대신',[shipment()]),null);
  assert.equal(carrier.exportCarrier('로젠',[shipment(),shipment({carrier:'대신'})]),null);
  assert.equal(carrier.exportCarrier('로젠',[shipment()]),'로젠');
  assert.equal(carrier.exportCarrier('대신',[{carrier:undefined}]),'대신');
});
test('Daesin Excel schema, item and prepaid label remain unchanged', () => {
  const daesin=helpers.toTemplateRow(shipment({carrier:'대신',item:'부품'}),()=> '12345');
  assert.deepEqual(Object.keys(daesin),helpers.TEMPLATE_HEADERS);
  assert.equal(daesin.운임구분,'현불');
  assert.equal(daesin.품명,'부품');
  assert.equal(daesin.우편번호,'12345');
  assert.equal(daesin.수화주전화1,'01012345678');
});
test('Logen Excel matches the ten-column template and preserves phone numbers', () => {
  const expectedHeaders=['수화주전화','수화주명','주소','수량','품명','운임구분','발화주명','발화주전화번호','총운임','특기사항'];
  assert.deepEqual(helpers.LOGEN_TEMPLATE_HEADERS,expectedHeaders);
  const input=shipment({item:'부품',postal_code:''});
  const logen=helpers.toLogenTemplateRow(input);
  assert.deepEqual(Object.keys(logen),expectedHeaders);
  assert.equal(logen.품명,'자동차부품');
  assert.equal(input.item,'부품');
  assert.equal(logen.운임구분,'신용');
  assert.equal(helpers.toLogenTemplateRow(shipment({pay:'착불',item:'다른 품목'})).운임구분,'착불');
  assert.equal(helpers.toLogenTemplateRow(shipment({item:'다른 품목'})).품명,'자동차부품');
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([logen]),'일괄업로드');
  const read=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const sheet=read.Sheets[read.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1});
  assert.deepEqual(rows[0],expectedHeaders);
  assert.deepEqual(rows[1],['01012345678','테스트수하인','경기도 수원시 테스트로 10 101호',2,'자동차부품','신용','상화시스템','03180595618',6600,'문 앞에 놓아주세요']);
  assert.equal(sheet.A2.t,'s'); assert.equal(sheet.H2.t,'s');
  assert.equal(sheet.D2.t,'n'); assert.equal(sheet.I2.t,'n');
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

test('parcel addresses retain regions, normalize province aliases and ignore parenthesized details', () => {
  const aliases=[['서울특별시','서울'],['부산광역시','부산'],['대구광역시','대구'],['인천광역시','인천'],['광주광역시','광주'],['대전광역시','대전'],['울산광역시','울산'],['세종특별자치시','세종'],['경기도','경기'],['강원특별자치도','강원'],['강원도','강원'],['충청북도','충북'],['충청남도','충남'],['전북특별자치도','전북'],['전라북도','전북'],['전라남도','전남'],['경상북도','경북'],['경상남도','경남'],['제주특별자치도','제주'],['제주도','제주']];
  for(const [full,short] of aliases) assert.equal(carrier.sameParcelAddress(full+' 테스트로 125 (테스트동 148) 101호',short+' 테스트로 125'),true,full);
  assert.equal(carrier.sameParcelAddress('충청북도 청주시 청원구 오창읍 테스트로 12번길 1-5 (테스트리 149-42, 아파트)','충북  청주시 청원구 오창읍 테스트로12번길 1-5（다른 상세주소）'),true);
  assert.equal(carrier.sameParcelAddress('경기도 광주시 테스트로 1','경기 광주시 테스트로 1'),true);
});
test('parcel address comparison rejects other regions, partial addresses and different building numbers', () => {
  const pairs=[
    ['경상북도 포항시 남구 시청로 18','전북특별자치도 군산시 시청로 18'],
    ['경상북도 포항시 남구 시청로 18','경북 포항시 북구 시청로 18'],
    ['경상북도 포항시 남구 시청로 18','시청로 18'],
    ['충청북도 청주시 청원구 시청로 18','충남 청주시 청원구 시청로 18'],
    ['서울특별시 중구 테스트로 18','서울 중구 테스트로 180'],
    ['서울특별시 중구 테스트로 1-5','서울 중구 테스트로 15'],
    ['서울특별시 중구 테스트로 10번길 1','서울 중구 테스트로 10번길 2'],
    ['경기도 광주시 테스트로 1','광주광역시 테스트로 1'],
    ['광주시 테스트로 1','광주광역시 테스트로 1'],
    ['',''],['(테스트동)','(테스트동)'],
  ];
  for(const [a,b] of pairs) assert.equal(carrier.sameParcelAddress(a,b),false,a+' / '+b);
});
test('both carriers use normalized parcel addresses in dispatch verification', () => {
  for(const name of ['대신','로젠']) {
    const s=shipment({carrier:name,address:'충청북도 청주시 청원구 테스트로 125 (테스트동 148) 101호',fare:7200});
    const u={...parse({수하인주소:'충북 청주시 청원구 테스트로 125',상세주소:'(테스트동) 202호',택배운임:7200}),carrier:name};
    const matched=helpers.buildWaybillVerificationRows([s],[u])[0];
    assert.equal(matched.status,'일치',name);assert.equal(matched.fareText,'7,200 / 7,200');
    for(const address of ['충북 청주시 청원구 테스트로 1250','전북 청주시 청원구 테스트로 125','']) {
      const mismatch=helpers.buildWaybillVerificationRows([s],[{...u,address}])[0];
      assert.equal(mismatch.status,'확인필요');assert.ok(mismatch.reasons.includes('주소 확인'));
    }
  }
});

test('shipment dates preserve legacy Korean dates and actual creation timestamps', () => {
  const midnight = shipment({ created_at: '2026-09-30T15:00:00.000Z' });
  assert.equal(midnight.shipmentDate, '2026-10-01');
  assert.equal(shipment({ created_at: '2026-09-30T14:59:59.000Z' }).shipmentDate, '2026-09-30');
  const planned = shipment({ shipment_date: '2026-10-05' });
  assert.equal(planned.shipmentDate, '2026-10-05');
  assert.equal(planned.createdAt, '2026-10-01T00:00:00.000Z');
  const payload = helpers.toShipmentDbPayload(planned);
  assert.equal(payload.shipment_date, '2026-10-05');
  assert.equal(Object.hasOwn(payload, 'created_at'), false);
  assert.notEqual(JSON.stringify(payload), JSON.stringify(helpers.toShipmentDbPayload(shipment())));
});

test('shipment dates reject empty and invalid dates while allowing leap dates', () => {
  for (const date of ['', '2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-2']) {
    assert.equal(helpers.isValidShipmentDate(date), false, date);
    assert.throws(() => helpers.toShipmentDbPayload({ ...shipment(), shipmentDate: date }), /출고일자/);
  }
  for (const date of ['2028-02-29', '2026-10-05', '2027-01-01']) {
    assert.equal(helpers.isValidShipmentDate(date), true, date);
  }
});

test('Daesin half-box exports as one physical box without changing its fare or internal quantity', () => {
  const input=shipment({carrier:'대신',qty:0.5,fare:6600,pay:'착불'});
  const mapped=helpers.toTemplateRow(input,()=> '18624');
  assert.equal(mapped.수량,1); assert.equal(mapped.총운임,6600); assert.equal(Number(input.qty),0.5);
  const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([mapped]),'Sheet1');
  const parsed=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets.Sheet1)[0].수량,1);
});

test('live registration accepts numbered named tests after recreation, without fixed IDs', () => {
  for (const id of ['2760', '990001', '990002']) for (const index of [1,2,3,4,10]) {
    assert.equal(helpers.isLiveDaesinTestShipment({id, receiver:'대신자동업로드테스트'+index, shipmentDate:'2026-10-06', carrier:'대신'}), true);
  }
  const allowed = {receiver:'대신자동업로드테스트1', shipmentDate:'2026-10-06', carrier:'대신'};
  for (const patch of [{receiver:'대신자동업로드테스트'}, {receiver:'일반 거래처'}, {receiver:'대신자동업로드테스트0'}, {carrier:'로젠'}, {shipmentDate:'2026-10-07'}]) {
    assert.equal(helpers.isLiveDaesinTestShipment({...allowed,...patch}), false);
  }
});

test('Logen verification accepts the observed Gwangju aliases without suppressing other errors',()=>{
  const s=shipment({qty:1,fare:3300,address:'전남광주통합특별시 순천시 남산로 43 (남정동)'});
  const u=parse({박스수량:1,택배운임:3300,수하인주소:'광주 순천시 남산로 43 (남정동 559-5)',상세주소:'(남정동)'});
  const matched=helpers.buildWaybillVerificationRows([s],[u])[0];
  assert.equal(matched.status,'일치');assert.deepEqual(matched.reasons,[]);
  for(const [patch,reason] of [[{address:'광주 순천시 남산로 44'},'주소 확인'],[{fare:3500},'택배운임 확인']]){
    const mismatch=helpers.buildWaybillVerificationRows([s],[{...u,...patch}])[0];
    assert.equal(mismatch.status,'확인필요');assert.ok(mismatch.reasons.includes(reason));
  }
});

test('Daesin combined transport/payment fields retain full verification data', () => {
  for (const [label, delivery, pay] of [
    ['택배(착불)', '택배', '착불'], ['택배(현불)', '택배', '선불'],
    ['정기(착불)', '정기', '착불'], ['정기(현불)', '정기', '선불'],
    ['화물(선불)', '정기', '선불'], [' 정기 （ 현불 ） ', '정기', '선불'],
  ]) {
    const raw = {수화주명:'테스트수하인',수화주전화:'010-1234-5678',발화주명:'별도발화주',발화주전화:'031-000-0000',
      주소:'경기도 수원시 테스트로 10 101호',도착영업소:'테스트영업소',운송장번호:'214064900999',
      수량:1,총운임:5500,운송구분:label};
    const [parsed] = helpers.parseWaybillUploadRows([raw], '대신');
    assert.equal(parsed.delivery, delivery, label); assert.equal(parsed.pay, pay, label);
    assert.equal(parsed.sender, '별도발화주'); assert.equal(parsed.address, raw.주소);
    assert.equal(parsed.senderPhone, raw.발화주전화); assert.equal(parsed.waybillNo, raw.운송장번호);
    assert.equal(parsed.raw.운송구분, label);
    const s=shipment({carrier:'대신',qty:1,fare:5500,delivery,pay,sender:'별도발화주',branch:'테스트영업소'});
    const [matched]=helpers.buildWaybillVerificationRows([s],[parsed]);
    assert.equal(matched.status,'일치',label);
    const [mismatch]=helpers.buildWaybillVerificationRows([s],[{...parsed,sender:'다른발화주',address:'경기도 수원시 테스트로 11',branch:'다른영업소',fare:6600}]);
    assert(mismatch.reasons.includes('발화주명 확인'));
    assert(mismatch.reasons.includes(delivery==='택배'?'주소 확인':'도착영업소 확인'));
    assert(mismatch.reasons.includes('총운임 확인'));
  }
});

test('Daesin separate columns take precedence over combined display labels', () => {
  const [parsed]=helpers.parseWaybillUploadRows([{수화주명:'테스트',운송상품:'화물',지불방법:'현불',운송구분:'택배(착불)'}],'대신');
  assert.equal(parsed.delivery,'정기'); assert.equal(parsed.pay,'선불');
});

test('automatic daily import preserves existing data on missing assigned/foreign/duplicate rows',()=>{
  const rows=[{waybill_no:'999999999991',arrival_name:'A',arrival_agencycode:'2401'},{waybill_no:'999999999992',arrival_name:'B',arrival_agencycode:'0000'}];
  const parsed=[{waybillNo:rows[0].waybill_no}];
  assert.deepEqual(helpers.validateDaesinDailyImport(parsed,{rows}),[rows[1]]);
  assert.throws(()=>helpers.validateDaesinDailyImport([],{rows}));
  assert.throws(()=>helpers.validateDaesinDailyImport([...parsed,...parsed],{rows}));
  assert.throws(()=>helpers.validateDaesinDailyImport([{waybillNo:'999999999999'}],{rows}));
  assert.throws(()=>helpers.validateDaesinDailyImport(parsed,{rows:rows.map(r=>({...r,arrival_agencycode:'2401'}))}));
});

test('full 13-digit number survives Excel parsing and automatic import validation',()=>{
 const [parsed]=helpers.parseWaybillUploadRows([{수화주명:'테스트',운송장번호:'2140649004964'}],'대신');
 assert.equal(parsed.waybillNo,'2140649004964');assert.deepEqual(helpers.validateDaesinDailyImport([parsed],{rows:[{waybill_no:'2140649004964',arrival_agencycode:'2401'}]}),[]);
});


test('Daesin bound invoice survives quantity, fare and recipient edits while discrepancies stay visible',()=>{
 const source=shipment({carrier:'대신',receiver:'수정한 업체명',qty:3,fare:19800,daesin_registration:{state:'registered',waybillNo:'9999999999991'}});
 const other=shipment({id:'2',carrier:'대신',receiver:'기존업체',qty:1,fare:6600});
 const uploads=helpers.parseWaybillUploadRows([{운송장번호:'9999999999991',수화주명:'기존업체',발화주명:'상화시스템',수화주전화:'01012345678',수화주주소:source.address,수량:1,총운임:6600,운송구분:'택배(착불)'}],'대신');
 const matched=helpers.buildWaybillVerificationRows([other,source],uploads);
 const bound=matched.find(row=>row.shipmentId===source.id);
 assert.equal(bound.waybillNo,'9999999999991');assert.equal(bound.status,'확인필요');
 assert.ok(bound.reasons.includes('수량 확인'));assert.ok(bound.reasons.includes('총운임 확인'));
 assert.equal(matched.find(row=>row.shipmentId==='2').status,'출고목록만');
 const payload=helpers.toShipmentDbPayload(source);assert.equal(Object.hasOwn(payload,'daesin_registration'),false,'normal edits do not erase carrier state');
});


test('Jeju list notices use carrier-specific wording and destination source',()=>{
 assert.equal(helpers.jejuShipmentNotice(shipment({carrier:'로젠',address:'제주특별자치도 서귀포시 예시로 10'})),'제주 | +3천원');
 assert.equal(helpers.jejuShipmentNotice(shipment({carrier:'대신',delivery:'택배',address:'제주시 예시로 10'})),'제주 | 운임X2');
 assert.equal(helpers.jejuShipmentNotice(shipment({carrier:'대신',delivery:'정기',address:'서울특별시',branch:'서귀포영업소'})),'제주 | 운임X2');
 assert.equal(helpers.jejuShipmentNotice(shipment({carrier:'로젠',address:'서울특별시',branch:'제주'})),'');
 assert.equal(helpers.jejuShipmentNotice(shipment({carrier:'대신',address:'서울특별시'})),'');
});

test('Logen registration status follows Excel export even before a carrier waybill exists',()=>{
 const source=shipment({waybill:false});
 assert.equal(helpers.shipmentRegistrationView(source).label,'미등록');
 source.checklist.waybill=true;
 assert.equal(helpers.shipmentRegistrationView(source).label,'등록완료');
 const upload=helpers.parseWaybillUploadRows([logenRaw({운송장번호:''})],'로젠')[0];
 const verified=helpers.buildWaybillVerificationRows([source],[upload])[0];
 assert.deepEqual(Array.from(verified.reasons),['운송장번호 없음']);
 assert.equal(verified.uploadId,upload.id);
 assert.equal(helpers.shipmentRegistrationView(source,verified).label,'등록완료');
});
test('Logen discrepancies override downloaded state and retain detail without an invoice',()=>{
 const source=shipment({waybill:true});
 const upload=helpers.parseWaybillUploadRows([logenRaw({운송장번호:'',택배운임:'9900',박스수량:'3'})],'로젠')[0];
 const verified=helpers.buildWaybillVerificationRows([source],[upload])[0];
 const status=helpers.shipmentRegistrationView(source,verified);
 assert.equal(status.label,'정보확인');assert.equal(status.registered,true);
 assert.deepEqual(Array.from(status.reasons).sort(),['박스수량 확인','택배운임 확인']);
 assert.equal(status.waybillNo,'');
 const fixed=helpers.buildWaybillVerificationRows([source],helpers.parseWaybillUploadRows([logenRaw({운송장번호:''})],'로젠'))[0];
 assert.equal(helpers.shipmentRegistrationView(source,fixed).label,'등록완료');
});
test('Daesin registration is not inferred from a manual Excel download or checklist marker',()=>{
 const source=shipment({carrier:'대신',waybill:true});
 assert.equal(helpers.shipmentRegistrationView(source).label,'미등록');
 source.daesinRegistration={state:'registered',waybillNo:'2140649004960',destinationNeedsReview:true,destinationReason:'공동관할구역'};
 const status=helpers.shipmentRegistrationView(source,{waybillNo:'2140649004960',status:'일치',reasons:[]});
 assert.equal(status.label,'정보확인');assert.equal(status.registered,true);assert.match(status.reasons[0],/공동관할구역/);
});
