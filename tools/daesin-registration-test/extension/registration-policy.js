'use strict';
function isDaesinRegistrationBlocked(text) {
  return /(?:택배|정기|화물|배송|접수|등록)[^\n]{0,15}(?:불가|불가능|거절)|(?:등록|접수)\s*(?:실패|할 수 없)/.test(String(text || ''));
}
function classifyDaesinDestination(diagnosis) {
  const upload = diagnosis?.upload;
  if (upload?.rowCount !== 1 || upload.destinations?.length !== 1) return { kind: 'unknown', reason: '대신 변환 결과가 선택한 1건인지 확인하지 못했습니다.' };
  const destination = diagnosis.destination;
  const row = destination?.row || upload.destinations[0];
  const reason = String(row.unregistered_post || '').trim();
  const limit = !diagnosis.readError && destination?.blockedDestinationCount > 0;
  if (isDaesinRegistrationBlocked(reason) || limit) return { kind: 'blocked', reason: reason || destination.blockedDestinationCounter || '택배·정기불가' };
  const code = String(row.arrival_agencycode || '').trim();
  if (/공동관할|미지정|미설정|지정되지|설정되지/.test(reason) || /^0+$/.test(code) || (!diagnosis.readError && destination?.missingDestinationCount > 0)) {
    return { kind: 'destination-review', reason: reason || '도착지 미지정' };
  }
  if (/^\d{4}$/.test(code) && !/^0+$/.test(code) && !reason) return { kind: 'ready', reason: '' };
  return { kind: 'unknown', reason: reason || '대신의 도착지 변환 상태를 확인하지 못했습니다.' };
}
function hasDaesinRegistrationSuccess(job) {
  return job?.numbers?.length === 1 || job?.state === 'verified' ||
    (job?.diagnosis?.upload?.rowCount === 1 && job?.diagnosis?.registration?.result === 'SUCCESS');
}
function updateDaesinAcceptedState(job) {
  if (!hasDaesinRegistrationSuccess(job) || job.numbers?.length || !['unknown', 'needs-review', 'registered-awaiting-number'].includes(job.state)) return false;
  const message = '등록 완료 · 송장번호 확인 대기' + (job.destinationNeedsReview ? ' · 도착지 수정 필요: ' + job.destinationReason : '');
  const changed = job.state !== 'registered-awaiting-number' || job.message !== message;
  job.state = 'registered-awaiting-number'; job.message = message;
  return changed;
}

if (typeof module !== 'undefined') module.exports = { classifyDaesinDestination, isDaesinRegistrationBlocked, hasDaesinRegistrationSuccess, updateDaesinAcceptedState };
