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
  const row = [...hits][0];
  const name = receiver.normalize('NFKC').replace(/\s+/g, '');
  const receiverMatches = [...row.querySelectorAll('td, input')].some(element => (element instanceof HTMLInputElement ? element.value : element.textContent || '').normalize('NFKC').replace(/\s+/g, '') === name);
  return { found: receiverMatches, number, receiverMatches, reason: receiverMatches ? '' : '송장번호는 있으나 수화주명이 달라 직접 확인이 필요합니다.' };
}

function findCarrierShipmentWaybill(expected) {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/searchSvl' || url.searchParams.get('svcSid') !== 'dailySearch') return { found: false, reason: '일자별조회 화면이 아닙니다.' };
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
  const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const dateKey = value => {
    const match = String(value || '').trim().match(/^(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
    return match ? match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0') : '';
  };
  const selectedDates = [...document.querySelectorAll('input')].filter(visible).map(input => dateKey(input.value)).filter(Boolean);
  if (!selectedDates.length || selectedDates.some(date => date !== expected.shipmentDate)) return { found: false, reason: '일자별조회 날짜를 ' + expected.shipmentDate + '로 조회한 뒤 다시 눌러 주세요.' };
  const matches = [];
  let supportedTable = false, receiverRows = 0;
  for (const table of document.querySelectorAll('table')) {
    if (!visible(table)) continue;
    const rows = [...table.rows];
    const cleanLabel = cell => (cell.textContent || '').replace(/[^가-힣a-zA-Z0-9]/g, '');
    const header = rows.find(row => [...row.cells].map(cleanLabel).includes('운송장번호') && [...row.cells].map(cleanLabel).includes('수화주명'));
    if (!header) continue;
    const labels = [...header.cells].map(cleanLabel);
    const columns = Object.fromEntries(['운송장번호', '수화주명', '수량', '총운임', '운송구분', '등록일자'].map(label => [label, labels.indexOf(label)]));
    if (Object.values(columns).some(index => index < 0)) continue;
    supportedTable = true;
    for (const row of rows) {
      if (row === header || !visible(row)) continue;
      const cell = name => row.cells[columns[name]]?.innerText?.trim() || '';
      if (normalize(cell('수화주명')) !== normalize(expected.receiver)) continue;
      receiverRows++;
      const number = normalize(cell('운송장번호')).replace(/-/g, '');
      const quantity = Number(cell('수량').replace(/[,\s]/g, ''));
      const fare = Number(cell('총운임').replace(/[,원\s]/g, ''));
      const transport = normalize(cell('운송구분'));
      const registeredAt = cell('등록일자').match(/^(?:(20\d{2})[-./]\s*)?(\d{1,2})[-./]\s*(\d{1,2})\s+/);
      const [, year, month, day] = registeredAt || [];
      const rowDate = registeredAt ? (year || expected.shipmentDate.slice(0, 4)) + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') : '';
      const phoneColumn = labels.indexOf('수화주전화');
      const phone = phoneColumn < 0 ? '' : (row.cells[phoneColumn]?.innerText || '').replace(/\D/g, '');
      const expectedPhone = String(expected.receiverPhone || '').replace(/\D/g, '');
      const payMatches = !expected.pay || (expected.pay === '선불' ? /선불|현불/.test(transport) : /착불/.test(transport));
      if (!/^\d{12}$/.test(number) || rowDate !== expected.shipmentDate || quantity !== Number(expected.quantity) || fare !== Number(expected.fare) || !transport.startsWith(expected.delivery) || !payMatches || (expectedPhone && phone !== expectedPhone)) continue;
      const destinationColumn = labels.indexOf('도착지');
      const destination = destinationColumn < 0 ? '' : row.cells[destinationColumn]?.innerText?.trim() || '';
      matches.push({ number, destinationNeedsReview: /공동관할|미지정|미설정/.test(destination), destinationReason: /공동관할|미지정|미설정/.test(destination) ? destination : '' });
    }
  }
  const numbers = [...new Set(matches.map(match => match.number))];
  if (numbers.length !== 1 || receiverRows !== 1) return { found: false, ambiguous: receiverRows > 1, reason: !supportedTable ? '일자별조회 표의 필수 열을 확인하지 못했습니다.' : receiverRows > 1 ? '같은 수화주가 여러 행에 있어 송장번호를 자동 연결하지 않았습니다.' : '날짜·수화주명·수량·운임·운송구분이 모두 맞는 1건을 찾지 못했습니다.' };
  return { found: true, ...matches[0] };
}

function inspectDaesinDailyExportConnection() {
  const url = new URL(location.href);
  if (url.origin !== 'https://partner.ds3211.co.kr' || url.pathname !== '/searchSvl' || url.searchParams.get('svcSid') !== 'dailySearch') throw new Error('대신 일자별조회 화면이 아닙니다.');
  const visible = element => Boolean(element.getClientRects().length);
  const label = element => (element instanceof HTMLInputElement ? element.value : element.textContent || '').trim().replace(/\s+/g, ' ');
  const exports = [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].filter(element => visible(element) && label(element).replace(/\s/g, '') === '엑셀저장');
  const selections = [...document.querySelectorAll('select')].filter(element => visible(element) && [...element.options].some(option => option.text.trim() === '전체') && [...element.options].some(option => option.text.trim() === '접수'));
  const controls = [...exports, ...selections];
  const functions = [], seen = new Set(), queue = [];
  const codeOf = fn => {
    if (typeof fn !== 'function') return '';
    const source = Function.prototype.toString.call(fn);
    return /password|access[_-]?token|refresh[_-]?token|document\.cookie/i.test(source) ? '[민감정보 접근 코드 제외]' : source.slice(0, 12000);
  };
  const describe = element => {
    const handlers = [codeOf(element.onclick), codeOf(element.onchange)].filter(Boolean);
    if (window.jQuery?._data) {
      const events = window.jQuery._data(element, 'events') || {};
      for (const event of ['click', 'change']) for (const entry of events[event] || []) handlers.push(codeOf(entry.handler));
    }
    queue.push(...handlers);
    return { tag: element.tagName, id: element.id || '', name: element.getAttribute('name') || '', label: element.tagName === 'SELECT' ? '' : label(element), handlers,
      options: element.tagName === 'SELECT' ? [...element.options].map(option => ({ label: option.text.trim(), value: option.value })) : undefined };
  };
  const described = controls.map(describe);
  for (let i = 0; i < queue.length && functions.length < 12; i++) {
    for (const match of queue[i].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1];
      if (seen.has(name) || !/excel|down|export|select|check|save/i.test(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      const source = codeOf(descriptor?.value);
      if (source) { functions.push({ name, source }); queue.push(source); }
      if (functions.length >= 12) break;
    }
  }
  return { capturedAt: new Date().toISOString(), url: url.origin + url.pathname + '?svcGid=customer.search&svcSid=dailySearch',
    collection: 'Control labels, form field names, headers and export-handler definitions only; no shipment values, cookies, storage, export requests or print calls.',
    controls: described, functions,
    forms: [...document.forms].map(form => ({ id: form.id, method: form.method, actionPath: new URL(form.action || location.href).pathname, fields: [...form.elements].map(input => ({ tag: input.tagName, id: input.id, name: input.name, type: input.type })) })),
    tables: [...document.querySelectorAll('table')].filter(visible).map(table => ({ id: table.id, headers: [...table.querySelectorAll('th')].map(cell => (cell.textContent || '').trim().slice(0, 60)), rowCount: table.rows.length })),
    dates: [...document.querySelectorAll('input')].filter(input => visible(input) && /^20\d{2}[-./]\d{1,2}[-./]\d{1,2}$/.test(input.value)).map(input => ({ id: input.id, name: input.name, value: input.value }))
  };
}
