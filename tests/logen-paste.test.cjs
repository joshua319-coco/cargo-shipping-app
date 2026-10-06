const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/logen-paste.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};vm.runInThisContext('(function(exports,module){'+source+'\n})')(mod.exports,mod);
const {parseLogenPasteRows}=mod.exports;
function fixture(offset=0,patch={}) {
  const cells=Array(offset===-1?43:44).fill('');
  for(const [i,value] of Object.entries({0:'1',1:'0',2:'1',3:'1',4:'45308735441',6:'0'}))cells[Number(i)]=value;
  const fields={8:'테스트수하인',9:'충남 천안시 동남구 테스트로 800 (목천읍 예시리 393-4)',10:'101호',11:'01000000000',13:'1',14:'3300',15:'신용',19:'문 앞',24:'테스트발화주',25:'경기 화성시 테스트로 499-26',27:'020000000',...patch};
  for(const [i,value] of Object.entries(fields))cells[Number(i)+offset]=value;
  return cells.map(value=>/[\t\r\n"]/.test(value)?'"'+value.replaceAll('"','""')+'"':value).join('\t');
}
test('current Logen H-column receiver layout preserves names, one box, fare and waybill',()=>{
  const [row]=parseLogenPasteRows(fixture(-1));
  assert.equal(row.receiver,'테스트수하인');assert.equal(row.sender,'테스트발화주');
  assert.equal(row.qty,1);assert.equal(row.fare,3300);assert.equal(row.pay,'선불');
  assert.equal(row.receiverPhone,'01000000000');assert.equal(row.senderPhone,'020000000');
  assert.equal(row.waybillNo,'45308735441');assert.equal(row.memo,'문 앞');
  assert.match(row.address,/101호$/);
});
test('legacy and current layouts produce identical business fields regardless of trailing columns',()=>{
  const [old]=parseLogenPasteRows(fixture()),[current]=parseLogenPasteRows(fixture(-1)+'\t출력정보\t추가정보');
  assert.deepEqual(current,old);
});
test('multiple current rows retain empty cells and quoted messages',()=>{
  const rows=parseLogenPasteRows(fixture(-1,{19:'첫줄\n둘째줄\t"메모"'})+'\r\n'+fixture(-1,{8:'다른수하인',14:'3500',15:'착불'}));
  assert.equal(rows.length,2);assert.equal(rows[0].memo,'첫줄\n둘째줄\t"메모"');
  assert.equal(rows[1].receiver,'다른수하인');assert.equal(rows[1].qty,1);assert.equal(rows[1].fare,3500);assert.equal(rows[1].pay,'착불');
});
test('unknown shifted or invalid layouts fail without producing misleading applied rows',()=>{
  assert.throws(()=>parseLogenPasteRows(fixture(-2)),/열을 확인/);
  assert.throws(()=>parseLogenPasteRows(fixture(-1,{15:'자동차부품'})),/열을 확인/);
  assert.throws(()=>parseLogenPasteRows(fixture(-1,{14:'운임아님'})),/열을 확인/);
});
