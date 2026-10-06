const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/carriers.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};vm.runInThisContext('(function(exports,module){'+code+'\n})')(mod.exports,mod);
const {sameParcelAddress}=mod.exports;
test('Logen locality moved to parentheses still matches with all region and road fields retained',()=>{
  for(const [left,right] of [
    ['충청남도 천안시 동남구 목천읍 충절로 800','충남 천안시 동남구 충절로 800 (목천읍 신계리 393-4)'],
    ['충청남도 천안시 동남구 병천면 매성3길 24-15','충남 천안시 동남구 매성3길 24-15 (병천면 매성리 246-1)'],
    ['경기도 화성시 효행구 정남면 만년로 397-39 (정남면) 상호','경기 화성시 효행구 만년로 397-39 (정남면 신리 205-16)'],
    ['강원특별자치도 춘천시 동면 춘천로 542','강원 춘천시 춘천로 542 (동면 장학리 89-18)'],
    ['서울특별시 영등포구 선유로13길 25, B101호','서울 영등포구 선유로13길 25 (문래동6가 24-1) B101호'],
    ['전라북도 전주시 덕진구 테스트로 12번길 1-5','전북특별자치도 전주시 덕진구 테스트로 12번길 1-5 (예시동 1)'],
  ]) {assert.equal(sameParcelAddress(left,right),true,left);assert.equal(sameParcelAddress(right,left),true,right);}
});
test('locality restoration does not accept wrong or missing locality or different region/number',()=>{
  const source='충청남도 천안시 동남구 목천읍 충절로 800';
  for(const other of ['충남 천안시 동남구 충절로 800 (병천면 신계리 1)', '충남 천안시 동남구 충절로 800', '충남 천안시 서북구 충절로 800 (목천읍 신계리 1)', '충남 천안시 동남구 충절로 801 (목천읍 신계리 1)'])assert.equal(sameParcelAddress(source,other),false,other);
  assert.equal(sameParcelAddress('경북 포항시 남구 시청로 18','전북 군산시 시청로 18'),false);
  assert.equal(sameParcelAddress('서울특별시, 강남구 예시로 1','서울특별시, 강북구 예시로 2'),false);
  assert.equal(sameParcelAddress('경기 예시시 예시로 1-5','경기 예시시 예시로 15'),false);
});
