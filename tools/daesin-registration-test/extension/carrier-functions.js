'use strict';
// These functions execute in the carrier tab only after a reviewed one-row request.
function installCarrierRelay(jobId, nonce) {
  if (location.origin !== 'https://partner.ds3211.co.kr') return;
  const eventName = 'sanghwa-registration-' + nonce;
  window.addEventListener(eventName, event => {
    let detail;
    try { detail = JSON.parse(event.detail); } catch { return; }
    if (!['upload-response', 'submitting', 'registration-response', 'unknown'].includes(detail.kind)) return;
    chrome.runtime.sendMessage({ type: 'carrier-event', jobId, nonce, detail }).catch(() => {});
  });
}
async function stageCarrierWorkbook(job) {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/issueSvl' || url.searchParams.get('svcSid') !== 'excelIssuWay' || url.searchParams.get('svcGid') !== 'customer.issue') throw new Error('대신 엑셀일괄발행에 로그인한 상태로 다시 시도해 주세요.');
  // savedInformation() asynchronously selects this account's saved Excel format.
  // Wait for it; never guess or overwrite the carrier's format/route codes.
  const deadline = Date.now() + 15000;
  let lastSignature = '', stableSince = 0, ready = false;
  while (Date.now() < deadline) {
    const format = document.querySelector('#waybillFrm #excelFormClass');
    const signature = JSON.stringify([format?.value, [...document.querySelectorAll('#waybillFrm input[name=procCheck]')].map(el => [el.id, el.checked])]);
    const idle = document.readyState === 'complete' && format?.value?.trim() && (!window.jQuery || window.jQuery.active === 0);
    if (!idle || signature !== lastSignature) { stableSince = Date.now(); lastSignature = signature; }
    if (idle && Date.now() - stableSince >= 600) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('대신의 우편번호·엑셀 양식 설정 로딩을 확인하지 못해 파일을 전송하지 않았습니다. 대신 화면 설정을 확인해 주세요.');
  const input = document.querySelector('form#waybillFrm input#input-file[type=file]');
  if (!input || input.name !== 'inputRealFile') throw new Error('확인했던 대신 파일 입력란을 찾지 못했습니다. 전송하지 않았습니다.');
  if (input.files?.length) throw new Error('이미 파일이 있는 등록 화면에는 덮어쓰지 않습니다.');
  const emit = (kind, data = {}) => window.dispatchEvent(new CustomEvent('sanghwa-registration-' + job.nonce, { detail: JSON.stringify({ kind, ...data }) }));
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, endpoint, ...args) {
    requests.set(this, { method: String(method).toUpperCase(), url: new URL(endpoint, location.href) });
    return open.call(this, method, endpoint, ...args);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = requests.get(this);
    let service = '';
    if (request?.method === 'POST' && request.url.origin === location.origin && request.url.pathname === '/issueSvl') {
      try { service = (body instanceof FormData ? body : new URLSearchParams(typeof body === 'string' ? body : '')).get('svcSid') || ''; } catch {}
    }
    if (['excelUploadShowData', 'insertFixUnsongApply'].includes(service)) {
      const registration = service === 'insertFixUnsongApply';
      if (registration) {
        const form = document.querySelector('#waybillFrm');
        if (form) form.dataset.sanghwaSubmissionStarted = '1';
        emit('submitting');
      }
      this.addEventListener('loadend', () => {
        try {
          if (this.status < 200 || this.status >= 300) throw new Error('응답 상태 확인 필요');
          const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          if (registration) {
            // Only the specifically observed waybill field is read; unrelated responses are excluded.
            const raw = JSON.stringify(data.resultBillNos ?? '');
            const numbers = [...new Set(raw.match(/(?<!\d)\d{12}(?!\d)/g) || [])];
            emit('registration-response', { numbers, result: typeof data.result === 'string' || typeof data.result === 'number' ? data.result : null, message: typeof data.message === 'string' ? data.message.slice(0, 500) : '', responseReceived: true });
          } else {
            const destinationFields = ['arrival_agencycode', 'unregistered_post', 'unregistered_post_state', 'transit_mode'];
            const destinations = Array.isArray(data.insert) ? data.insert.slice(0, 3).map(row => Object.fromEntries(destinationFields.filter(key => row && Object.hasOwn(row, key)).map(key => [key, String(row[key] ?? '').slice(0, 160)]))) : [];
            // Give the carrier's own rendering callback time to update its destination counter.
            setTimeout(() => emit('upload-response', { rowCount: Array.isArray(data.insert) ? data.insert.length : null, destinations }), 100);
          }
        } catch { emit('unknown', { phase: registration ? 'registration' : 'upload' }); }
      }, { once: true });
    }
    return send.call(this, body);
  };
  const bytes = Uint8Array.from(atob(job.workbook), character => character.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], '상화_실제접수테스트_1건.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // The background worker may click only the explicitly authorized no-print button after this upload response.
  return { staged: true, bytes: bytes.length };
}
function inspectCarrierDestination() {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/issueSvl' || url.searchParams.get('svcSid') !== 'excelIssuWay') throw new Error('대신 엑셀일괄발행 화면을 열어 주세요.');
  const counter = document.querySelector('#span_not-selectedAgency');
  const text = counter?.textContent?.trim() || '';
  const digits = text.match(/\d+/);
  return {
    checkedAt: new Date().toISOString(), missingDestinationCount: digits ? Number(digits[0]) : null,
    destinationCounter: text.slice(0, 120),
    blockedDestinationCounter: document.querySelector('#span_limit-selectedAgency')?.textContent?.trim().slice(0, 160) || '',
    blockedDestinationCount: Number(document.querySelector('#span_limit-selectedAgency')?.textContent?.match(/\d+/)?.[0] || 0),
    row: (() => {
      const rows = document.querySelectorAll('#tbody_excelList tr');
      if (rows.length !== 1) return null;
      const code = rows[0].querySelector('input[id^="arrival_agencycode"]');
      if (!code) return null;
      return { arrival_agencycode: code.value, unregistered_post: rows[0].querySelector('input[id^="rowPostMsg"]')?.value || '' };
    })(),
    format: document.querySelector('#waybillFrm #excelFormClass')?.value || '',
    postalOptions: [...document.querySelectorAll('#waybillFrm input[name=procCheck]')].map(el => ({ id: el.id, checked: el.checked })),
  };
}
async function clickCarrierRegisterNoPrint(expected) {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/issueSvl' || url.searchParams.get('svcSid') !== 'excelIssuWay') throw new Error('대신 등록 화면이 아닙니다.');
  const form = document.querySelector('#waybillFrm');
  const rows = document.querySelectorAll('#tbody_excelList tr');
  if (!form || rows.length !== 1) throw new Error('대신 화면에 선택한 1건만 있는지 확인하지 못해 자동 등록을 멈췄습니다.');
  const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const candidates = [...document.querySelectorAll('button, a, input[type=button], input[type=submit]')].filter(element =>
    visible(element) && (element instanceof HTMLInputElement ? element.value : element.textContent || '').replace(/\s/g, '') === '등록(출력안함)'
  );
  if (candidates.length !== 1 || candidates[0].disabled || candidates[0].getAttribute('aria-disabled') === 'true') throw new Error('사용 가능한 ‘등록(출력안함)’ 버튼 1개를 찾지 못했습니다. 일반 등록 버튼은 누르지 않았습니다.');
  if (form.dataset.sanghwaNoPrintAttempted || form.dataset.sanghwaSubmissionStarted) return { clicked: false, repeated: true };
  const row = rows[0];
  const name = row.querySelector('input[id^="arrival_name"]');
  const quantity = row.querySelector('input[id^="quantity"]');
  const fare = row.querySelector('input[id^="total_amount"]');
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s/g, '');
  if (!name || normalize(name.value) !== normalize(expected.receiver) || !quantity || Number(quantity.value) !== Number(expected.quantity) || !fare || Number(fare.value.replace(/[,원\s]/g, '')) !== Number(expected.fare)) throw new Error('대신 행의 수화주·수량·운임이 전송한 건과 같은지 확인하지 못해 자동 등록을 멈췄습니다.');
  const checks = [...row.querySelectorAll('input[type=checkbox]')].filter(input => /^check\d+$/.test(input.id));
  if (checks.length !== 1 || checks[0].disabled) throw new Error('등록할 행의 체크박스 1개를 찾지 못했습니다.');
  if (!checks[0].checked) checks[0].click();
  // A native click runs Daesin's own handler, including its hidden row-selection fields.
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!checks[0].isConnected || !checks[0].checked || document.querySelectorAll('#tbody_excelList tr').length !== 1) throw new Error('등록할 행이 체크되지 않아 등록하지 않았습니다.');
  if (!candidates[0].isConnected || !visible(candidates[0])) throw new Error('등록(출력안함) 버튼이 변경되어 등록하지 않았습니다.');
  if (form.dataset.sanghwaSubmissionStarted) return { clicked: false, repeated: true };
  form.dataset.sanghwaNoPrintAttempted = '1';
  candidates[0].click();
  return { clicked: true };
}
function findCarrierWaybill(number, receiver) {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/searchSvl' || url.searchParams.get('svcSid') !== 'dailySearch') return { found: false, reason: '일자별조회 화면이 아닙니다.' };
  const hits = new Set();
  for (const element of document.querySelectorAll('a, td, input')) {
    if (!element.getClientRects().length) continue;
    const text = (element instanceof HTMLInputElement ? element.value : element.textContent || '').trim();
    if (text.replace(/[\s-]/g, '') !== number) continue;
    const row = element.closest('tr');
    if (row && row.getClientRects().length) hits.add(row);
  }
  if (hits.size !== 1) return { found: false, reason: hits.size ? '같은 송장번호가 여러 행에 있어 확인이 필요합니다.' : '현재 조회목록에서 송장번호를 찾지 못했습니다.' };
  const rowText = [...hits][0].innerText.replace(/\s+/g, '');
  const receiverMatches = rowText.includes(receiver.replace(/\s+/g, ''));
  return { found: receiverMatches, number, receiverMatches, reason: receiverMatches ? '' : '송장번호는 있으나 수화주명이 달라 직접 확인이 필요합니다.' };
}
