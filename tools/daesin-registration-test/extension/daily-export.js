'use strict';

// Endpoints and downloadFlg=Y are taken from Daesin search_ctrl.js (2026-10-06).
// This isolated-world function uses the logged-in tab's same-origin session.
// It never invokes the shared native print callback or changes row selection.
async function fetchDaesinDailyWorkbook(shipmentDate) {
  const diagnosis = { shipmentDate, stage: 'page', checkedAt: new Date().toISOString() };
  const url = new URL(location.href);
  const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
  const loginMessage = '대신 로그인이 필요합니다. 대신 탭에서 로그인한 뒤 출고관리로 돌아와 새로고침을 다시 눌러 주세요.';
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/searchSvl' || url.searchParams.get('svcSid') !== 'dailySearch') return { diagnosis, code: 'LOGIN_REQUIRED', error: loginMessage };
  const form = document.querySelector('#searchForm');
  if (!form || !form.querySelector('#dailyStartDate')) return { diagnosis, code: 'LOGIN_REQUIRED', error: loginMessage };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) return { diagnosis, error: '조회 날짜를 확인해 주세요.' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40000);
  const request = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, ...options });
    if (response.status === 401 || response.status === 403) fail(loginMessage, 'LOGIN_REQUIRED');
    if (!response.ok) fail('대신 발송데이터 요청 실패 (' + response.status + '). 로그인 상태를 확인해 주세요.');
    return response;
  };
  try {
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === 'string') query.set(key, value);
    query.set('svcGid', 'customer.search'); query.set('svcSid', 'selectArticleList');
    query.set('selectSearchType', '1'); query.set('dailyStartDate', shipmentDate); query.set('stopoverRoute', '');
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
    diagnosis.stage = 'query';
    const listing = await (await request('/searchSvl', { method: 'POST', headers, body: query.toString() })).json();
    diagnosis.responseKeys = Object.keys(listing || {}).slice(0, 30);
    diagnosis.responseResult = typeof listing?.result === 'string' ? listing.result.slice(0, 40) : null;
    diagnosis.responseMessage = typeof listing?.message === 'string' ? listing.message.slice(0, 300) : '';
    const resultList = listing?.resultList;
    diagnosis.resultListType = resultList === null ? 'null' : Array.isArray(resultList) ? 'array' : typeof resultList;
    diagnosis.resultKeys = resultList && typeof resultList === 'object' ? Object.keys(resultList).slice(0, 30) : [];
    if (listing?.result === 'ERROR') fail(String(listing.message || '대신 조회가 거절되었습니다.'));
    if (listing?.result !== 'SUCCESS') fail('대신 조회가 정상 완료됐는지 확인하지 못해 연동을 멈췄습니다. 기존 데이터는 유지합니다.');
    // Daesin search_ctrl.js renders totalCount=0 when resultList is an empty string.
    // Recognize that exact successful response, never missing/malformed lists or failed queries.
    const rows = resultList === '' ? [] : resultList?.rows;
    diagnosis.stage = 'numbers';
    diagnosis.rowCount = Array.isArray(rows) ? rows.length : null;
    if (Array.isArray(rows) && rows.length === 0) {
      diagnosis.stage = 'complete';
      diagnosis.emptyRepresentation = resultList === '' ? 'empty-string' : 'rows';
      return { diagnosis, shipmentDate, rows: [], workbook: '', fileName: '' };
    }
    if (!Array.isArray(rows)) fail('대신 조회 응답의 목록 형식을 확인하지 못해 연동을 멈췄습니다. 기존 데이터는 유지합니다.');
    if (rows.length > 1000) fail('대신 엑셀저장은 한 번에 최대 1,000건입니다.');
    const numbers = rows.map(row => String(row?.waybill_no ?? '').replace(/[\s-]/g, ''));
    const invalid = [], grouped = new Map();
    rows.forEach((row, index) => {
      const number = numbers[index];
      if (!/^\d{12,13}$/.test(number)) invalid.push({ row: index + 1, type: typeof row?.waybill_no, value: String(row?.waybill_no ?? '').slice(0, 80), length: number.length, fields: Object.keys(row || {}).slice(0, 60) });
      else { const indices = grouped.get(number) || []; indices.push(index + 1); grouped.set(number, indices); }
    });
    const duplicates = [...grouped].filter(([, indices]) => indices.length > 1).map(([number, indices]) => ({ number, rows: indices }));
    diagnosis.invalidCount = invalid.length;
    diagnosis.blankCount = invalid.filter(item => !item.value.trim()).length;
    diagnosis.duplicateCount = duplicates.length;
    diagnosis.invalidSamples = invalid.slice(0, 10);
    diagnosis.duplicateSamples = duplicates.slice(0, 10);
    if (invalid.length || duplicates.length) {
      const reasons = [];
      if (diagnosis.blankCount) reasons.push('빈 번호 ' + diagnosis.blankCount + '행');
      if (invalid.length > diagnosis.blankCount) reasons.push('번호 형식 오류 ' + (invalid.length - diagnosis.blankCount) + '행');
      if (duplicates.length) reasons.push('중복 번호 ' + duplicates.length + '개');
      fail('대신 조회 ' + rows.length + '건 중 ' + reasons.join(' · ') + '로 가져오기를 중단했습니다. 확인결과 파일에 문제 행을 기록했습니다. 기존 데이터는 유지됩니다.');
    }
    diagnosis.stage = 'export';
    const body = new URLSearchParams({ waybillNos: numbers.join(','), downloadFlg: 'Y', sortColumn: query.get('sortColumn') || '', sortOrder: query.get('sortOrder') || '' });
    const exported = await (await request('/searchSvl?svcGid=customer.search&svcSid=selectLabelPrintList', { method: 'POST', headers, body: body.toString() })).json();
    if (exported.result === 'ERROR') fail(String(exported.message || '대신 엑셀 생성이 실패했습니다.'));
    const filePath = exported.resultList?.filePath;
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 2048) fail('대신이 엑셀 파일 경로를 반환하지 않았습니다.');
    const download = '/searchSvl?' + new URLSearchParams({ svcGid: 'customer.search', svcSid: 'downloadFile', path: filePath });
    diagnosis.stage = 'download';
    const response = await request(download);
    if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) fail('엑셀 파일이 10MB를 초과합니다.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail('엑셀 파일 크기를 확인해 주세요.');
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const keys = ['waybill_no', 'arrival_name', 'arrival_phone_number1', 'quantity', 'supply_price', 'tax_amount', 'transit_mode', 'payment_mode', 'arrival_agencycode', 'arrival_agencyname'];
    diagnosis.stage = 'complete';
    return { diagnosis, shipmentDate, fileName: '대신_발송데이터_' + shipmentDate + '.xls', workbook: btoa(binary),
      rows: rows.map((row, index) => Object.fromEntries(keys.map(key => [key, key === 'waybill_no' ? numbers[index] : String(row[key] ?? '')]))) };
  } catch (error) {
    return {diagnosis, code:error.code, error:error.name === 'AbortError' ? '대신 데이터 응답 시간이 초과됐습니다. 발송데이터 가져오기만 다시 시도해 주세요.' : error.message || String(error)};
  } finally { clearTimeout(timer); }
}

function reconcileDaesinDailyJobs(jobs, rows, shipmentDate) {
  const text = value => String(value || '').normalize('NFKC').replace(/\s/g, '');
  const digits = value => String(value || '').replace(/\D/g, '');
  for (const job of jobs) {
    if (job.supersededBy || job.shipmentDate !== shipmentDate || !hasDaesinRegistrationSuccess(job)) continue;
    const known = job.numbers?.length === 1 ? rows.filter(row => row.waybill_no === job.numbers[0]) : [];
    job.carrierMissing = job.numbers?.length === 1 && known.length === 0;
    const source = job.diagnosis?.source || {};
    const candidates = rows.filter(row => text(row.arrival_name) === text(job.receiver));
    const row = known.length === 1 ? known[0] : candidates.length === 1 ? candidates[0] : null;
    const delivery = row?.transit_mode === '1' ? '정기' : row?.transit_mode === '2' ? '택배' : '';
    const pay = row?.payment_mode === '1' ? '선불' : row?.payment_mode === '2' ? '착불' : '';
    const matches = known.length === 1 || (row && /^\d{12,13}$/.test(row.waybill_no) && Number(row.quantity) === Number(source.quantity) &&
      Number(row.supply_price) + Number(row.tax_amount) === Number(source.fare) && delivery === (source.delivery === '화물' ? '정기' : source.delivery) &&
      (!source.pay || pay === source.pay) && (!source.receiverPhone || digits(row.arrival_phone_number1) === digits(source.receiverPhone)));
    if (!matches || (job.numbers?.length && !job.numbers.includes(row.waybill_no))) {
      job.lookupMessage = candidates.length > 1 ? '같은 수화주가 여러 건입니다. 송장검증에서 확인해 주세요.' : '조회 정보가 등록 당시 정보와 일치하지 않습니다. 송장검증에서 확인해 주세요.';
      continue;
    }
    job.numbers = [row.waybill_no]; job.state = 'verified'; job.lookupMessage = '';
    job.destinationNeedsReview = row.arrival_agencycode === '0000';
    job.destinationReason = job.destinationNeedsReview ? '도착지 미지정' : '';
    job.message = '대신 조회 응답에서 송장번호 확인됨' + (job.destinationNeedsReview ? ' · 마감관리에서 도착지 수정 필요' : '');
    job.updatedAt = new Date().toISOString();
  }
  return jobs;
}
if (typeof module !== 'undefined') module.exports = { reconcileDaesinDailyJobs };
