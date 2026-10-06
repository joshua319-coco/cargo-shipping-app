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
function stageCarrierWorkbook(job) {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/issueSvl' || url.searchParams.get('svcSid') !== 'excelIssuWay' || url.searchParams.get('svcGid') !== 'customer.issue') throw new Error('대신 엑셀일괄발행에 로그인한 상태로 다시 시도해 주세요.');
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
      if (registration) emit('submitting');
      this.addEventListener('loadend', () => {
        try {
          if (this.status < 200 || this.status >= 300) throw new Error('응답 상태 확인 필요');
          const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          if (registration) {
            // Only the specifically observed waybill field is read; unrelated responses are excluded.
            const raw = JSON.stringify(data.resultBillNos ?? '');
            const numbers = [...new Set(raw.match(/(?<!\d)\d{12}(?!\d)/g) || [])];
            emit('registration-response', { numbers, result: typeof data.result === 'string' || typeof data.result === 'number' ? data.result : null, message: typeof data.message === 'string' ? data.message.slice(0, 500) : '', responseReceived: true });
          } else emit('upload-response', { rowCount: Array.isArray(data.insert) ? data.insert.length : null });
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
  // The final register/print action is deliberately left to the carrier's native reviewed UI.
  return { staged: true, bytes: bytes.length };
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
