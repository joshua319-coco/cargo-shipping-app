const test=require('node:test'),assert=require('node:assert/strict');
const {classifyDaesinDestination:c,isDaesinRegistrationBlocked:blocked}=require('../tools/daesin-registration-test/extension/registration-policy.js');
const diagnosis=(code,reason='',extra={})=>({upload:{rowCount:1,destinations:[{arrival_agencycode:code,unregistered_post:reason}]},...extra});
test('blank missing-destination counter with assigned agency is ready, not an error',()=>{
  assert.equal(c(diagnosis('2422','',{destination:{missingDestinationCount:null,destinationCounter:''}})).kind,'ready');
});
test('shared/unspecified destinations remain registerable and require post-registration correction',()=>{
  for(const reason of ['공동관할구역','도착지 미지정','도착지가 설정되지 않은 운송상품이 있습니다.'])assert.equal(c(diagnosis('0000',reason)).kind,'destination-review');
  assert.equal(c(diagnosis('0000')).kind,'destination-review');
});
test('carrier-prohibited shipments are distinguished from registerable warnings',()=>{
  for(const reason of ['택배,정기불가','택배불가','정기불가','택배 처리 불가능','등록할 수 없습니다']){assert.equal(blocked(reason),true);assert.equal(c(diagnosis('0000',reason)).kind,'blocked');}
  assert.equal(blocked('공동관할구역'),false);assert.equal(blocked('도착지 미지정'),false);
});
test('unknown/multirow results cannot initiate automatic one-row registration',()=>{
  assert.equal(c({}).kind,'unknown');assert.equal(c({...diagnosis('2422'),upload:{rowCount:2,destinations:[{},{}]}}).kind,'unknown');
  assert.equal(c(diagnosis('','알 수 없는 상태')).kind,'unknown');
});
