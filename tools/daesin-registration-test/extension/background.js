'use strict';
importScripts('registration-policy.js', 'carrier-functions.js', 'daily-export.js');
const APP_ORIGINS = ['http://127.0.0.1:4320', 'https://cargo-shipping-app.vercel.app'], CARRIER = 'https://partner.ds3211.co.kr';
const REGISTER = CARRIER + '/issueSvl?svcGid=customer.issue&svcSid=excelIssuWay';
const DAILY = CARRIER + '/searchSvl?svcGid=customer.search&svcSid=dailySearch';
const KEY = 'sanghwaLiveRegistrationJobs';
let staging = false, serial = Promise.resolve(), activeOperation = null;
const readJobs = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
const saveJobs = jobs => chrome.storage.local.set({ [KEY]: jobs });
const publicJob = job => job ? { id: job.id, attemptId: job.attemptId || job.id, fingerprint: job.fingerprint, shipmentId: job.shipmentId, shipmentDate: job.shipmentDate, receiver: job.receiver, state: job.state, registered: hasDaesinRegistrationSuccess(job), numbers: job.numbers || [], message: job.message || '', updatedAt: job.updatedAt, tabId: job.tabId, destinationNeedsReview: Boolean(job.destinationNeedsReview), destinationReason: job.destinationReason || '', lookupMessage: job.lookupMessage || '' } : null;
function isApp(sender) { try { return sender.frameId === 0 && APP_ORIGINS.includes(new URL(sender.url).origin); } catch { return false; } }
async function waitForTab(tabId) {
  for (let i = 0; i < 40; i++) { const tab = await chrome.tabs.get(tabId); if (tab.status === 'complete' && tab.url?.startsWith(CARRIER + '/')) return tab; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error('대신 화면을 여는 시간이 초과됐습니다. 접수 결과를 자동으로 재시도하지 않습니다.');
}
async function stage(request, sourceTab) {
  if (staging) throw new Error('다른 전송이 진행 중입니다.');
  staging = true;
  try {
    const p = request.payload;
    if (!p || typeof p.workbook !== 'string' || p.workbook.length > 1400000 || !/^[A-Za-z0-9+/]+=*$/.test(p.workbook) || !/^\d+$/.test(p.shipmentId) || !/^[a-f0-9]{64}$/.test(p.fingerprint) || typeof p.receiver !== 'string' || !p.receiver.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(p.shipmentDate)) throw new Error('출고 1건의 전송정보를 확인할 수 없습니다.');
    if (!/^[a-f0-9-]{36}$/.test(p.attemptId || '') || new Date(p.shipmentDate).toISOString().slice(0,10) !== p.shipmentDate) throw new Error('공유 등록 이력을 먼저 확보한 요청만 접수합니다.');
    if (p.autoRegister !== true) throw new Error('업로드 후 등록(출력안함)까지 진행하는 출고사이트를 새로고침해 주세요.');
    let jobs = await readJobs();
    const previous = [...jobs].reverse().find(job => job.shipmentId === p.shipmentId);
    if (previous && !(previous.state === 'not-registered' && p.retry === true && previous.fingerprint !== p.fingerprint && previous.attemptId !== p.attemptId)) { return { ok: true, job: publicJob(previous), repeated: true }; }
    const job = { id: crypto.randomUUID(), attemptId: p.attemptId, nonce: crypto.randomUUID(), shipmentId: p.shipmentId, shipmentDate: p.shipmentDate, fingerprint: p.fingerprint, receiver: p.receiver, autoRegister: true, state: 'opening', updatedAt: new Date().toISOString() };
    const source = p.source || {};
    job.diagnosis = { source: Object.fromEntries(['postalCode', 'address', 'branch', 'quantity', 'fare', 'delivery', 'receiverPhone', 'pay'].filter(key => ['string', 'number'].includes(typeof source[key])).map(key => [key, String(source[key]).slice(0, 500)])) };
    jobs.push(job); await saveJobs(jobs);
    try {
      const tab = await chrome.tabs.create({ url: REGISTER, active: false, ...(Number.isInteger(sourceTab?.windowId) ? { windowId: sourceTab.windowId } : {}) });
      job.tabId = tab.id; job.state = 'opening'; await saveJobs(jobs);
      const loaded = await waitForTab(tab.id);
      if (new URL(loaded.url).pathname !== '/issueSvl') {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        throw new Error('대신 로그인이 필요합니다. 로그인 후 출고관리에서 접수 상태를 확인해 주세요.');
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: installCarrierRelay, args: [job.id, job.nonce] });
      job.state = 'staged'; job.message = '업로드 확인 후 등록(출력안함)까지 진행합니다.'; job.deadlineAt = Date.now() + 60000; await saveJobs(jobs);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: stageCarrierWorkbook, args: [{ workbook: p.workbook, nonce: job.nonce, shipmentDate: p.shipmentDate }] });
      return { ok: true, job: publicJob(job) };
    } catch (error) {
      jobs = await readJobs(); const current = jobs.find(item => item.id === job.id);
      current.state = 'needs-review'; current.message = String(error.message || error); current.updatedAt = new Date().toISOString(); await saveJobs(jobs);
      throw new Error(current.message + ' 같은 출고건을 다시 전송하지 않고 대신 화면부터 확인해 주세요.');
    }
  } finally { staging = false; }
}
async function carrierEvent(message, sender) {
  if (sender.frameId !== 0 || !sender.url?.startsWith(CARRIER + '/issueSvl')) return { ok: false };
  const jobs = await readJobs(), job = jobs.find(item => item.id === message.jobId);
  if (!job || job.tabId !== sender.tab?.id || job.nonce !== message.nonce) return { ok: false };
  const d = message.detail;
  if (d.kind === 'submitting') { job.submissionStarted = true; job.state = 'submitting'; job.message = '대신 최종 접수 응답을 기다리고 있습니다.'; }
  if (d.kind === 'upload-response') {
    job.diagnosis ||= {};
    job.diagnosis.upload = { rowCount: d.rowCount, destinations: d.destinations, result: d.result, message: d.message };
    await readDestination(job);
    // Only a NEW explicit automatic request may proceed; old 0.2 jobs remain observational.
    if (job.autoRegister && !job.autoAttempted && ['carrier-ready', 'destination-pending'].includes(job.state)) {
      job.autoAttempted = true; job.state = 'registering'; job.deadlineAt = Date.now() + 60000;
      job.message = '등록(출력안함)을 진행하고 있습니다.'; await saveJobs(jobs);
      try {
        const [click] = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, world: 'MAIN', func: clickCarrierRegisterNoPrint, args: [{ shipmentDate: job.shipmentDate, receiver: job.receiver, quantity: job.diagnosis.source.quantity, fare: job.diagnosis.source.fare }] });
        if (!click?.result?.clicked) throw new Error('이미 등록을 시도한 화면입니다. 대신 접수 결과를 먼저 확인해 주세요.');
      } catch (error) { job.state = 'needs-review'; job.message = String(error.message || error); }
    }
  }
  if (d.kind === 'registration-response') {
    const numbers = Array.isArray(d.numbers) ? d.numbers.filter(number => /^\d{12,13}$/.test(number)) : [];
    job.numbers = [...new Set(numbers)]; job.state = job.numbers.length === 1 ? 'response-received' : 'needs-review';
    job.diagnosis.registration = { result: d.result, message: typeof d.message === 'string' ? d.message.slice(0, 500) : '' };
    if (job.numbers.length === 1) job.message = '등록 완료 · 송장번호 ' + job.numbers[0] + (job.destinationNeedsReview ? ' · 도착지 수정 필요: ' + job.destinationReason + ' (대신 마감관리에서 수정)' : ' · 출력안함');
    else if (d.result === 'SUCCESS') { job.state = 'registered-awaiting-number'; updateDaesinAcceptedState(job); }
    else if (isDaesinRegistrationBlocked(d.message)) { job.state = 'not-registered'; job.message = '등록 안됨 · ' + d.message; }
    else { job.state = 'unknown'; job.message = '접수 응답은 받았지만 송장번호를 확인하지 못했습니다. 대신 목록 확인이 필요하며 자동 재접수하지 않습니다.'; }
  }
  if (d.kind === 'unknown') { job.state = 'unknown'; job.message = '통신 결과가 불명확합니다. 대신 일자별조회에서 확인하기 전에는 다시 접수하지 마세요.'; }
  job.updatedAt = new Date().toISOString(); await saveJobs(jobs); return { ok: true };
}
async function readDestination(job) {
  job.diagnosis ||= {};
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, world: 'MAIN', func: inspectCarrierDestination });
    if (!result?.result) throw new Error('대신 도착지 결과를 읽지 못했습니다.');
    job.diagnosis.destination = result.result;
    delete job.diagnosis.readError;
  } catch (error) { job.diagnosis.readError = String(error.message || error); }
  // A later inspection must never turn an uncertain/submitted result into a new upload.
  if (job.submissionStarted || !['staged', 'carrier-review', 'carrier-ready', 'destination-pending', 'needs-review', 'not-registered'].includes(job.state) || job.numbers?.length) return;
  const result = classifyDaesinDestination(job.diagnosis);
  job.destinationNeedsReview = result.kind === 'destination-review'; job.destinationReason = result.reason;
  job.state = result.kind === 'ready' ? 'carrier-ready' : result.kind === 'destination-review' ? 'destination-pending' : result.kind === 'blocked' ? 'not-registered' : 'needs-review';
  job.message = result.kind === 'blocked' ? '등록 안됨 · ' + result.reason
    : result.kind === 'destination-review' ? '등록 가능한 건입니다. 접수 후 도착지 수정 필요 · ' + result.reason
    : result.kind === 'ready' ? '대신에서 1건을 읽었습니다. 도착영업소가 지정되어 있습니다.'
    : result.reason + ' 대신 화면을 확인해 주세요.';
}
async function inspect(jobId) {
  const jobs = await readJobs(), job = jobs.find(item => item.id === jobId);
  if (!job?.tabId) throw new Error('전송했던 대신 등록 화면이 필요합니다.');
  await readDestination(job); job.updatedAt = new Date().toISOString(); await saveJobs(jobs);
  return { ok: true, job: publicJob(job) };
}
async function fetchDaily(shipmentDate, sourceTab) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate) || new Date(shipmentDate).toISOString().slice(0,10) !== shipmentDate) throw new Error('조회 날짜를 확인해 주세요.');
  const tabs = (await chrome.tabs.query({ url: CARRIER + '/searchSvl*', ...(Number.isInteger(sourceTab?.windowId) ? { windowId: sourceTab.windowId } : {}) })).filter(tab => new URL(tab.url).searchParams.get('svcSid') === 'dailySearch');
  tabs.sort((a,b) => Number(b.active)-Number(a.active) || (b.lastAccessed||0)-(a.lastAccessed||0) || b.id-a.id);
  if (!tabs.length) { const tab = await chrome.tabs.create({ url: DAILY, active: false, ...(Number.isInteger(sourceTab?.windowId) ? { windowId: sourceTab.windowId } : {}) }); await waitForTab(tab.id); tabs.push(tab); }
  const [result] = await chrome.scripting.executeScript({target:{tabId:tabs[0].id},world:'ISOLATED',func:fetchDaesinDailyWorkbook,args:[shipmentDate]});
  const attempt = { ...(result?.result?.diagnosis || { shipmentDate, stage: 'page' }), error: result?.result?.error || result?.error?.message || '', version: '0.6.1' };
  const history = (await chrome.storage.local.get('sanghwaDailyFetchHistory')).sanghwaDailyFetchHistory || [];
  await chrome.storage.local.set({ sanghwaDailyFetchHistory: [...history, attempt].slice(-5) });
  if (result?.result?.error) {
    // Reading data must not steal focus. Only an expired login needs the user in the carrier tab.
    if (result.result.code === 'LOGIN_REQUIRED') await chrome.tabs.update(tabs[0].id, { active: true }).catch(() => {});
    throw new Error(result.result.error);
  }
  if ((!result?.result?.workbook && result?.result?.rows?.length !== 0) || !Array.isArray(result?.result?.rows)) throw new Error(result?.error?.message || '대신 엑셀 응답을 받지 못했습니다. 로그인 상태와 조회 날짜를 확인해 주세요.');
  const dataset = result.result;
  const jobs = reconcileDaesinDailyJobs(await readJobs(), dataset.rows, shipmentDate);
  await saveJobs(jobs);
  return {ok:true,version:'0.6.1',jobs:jobs.map(publicJob),dataset};
}
async function handle(message, sender) {
  if (message.type === 'carrier-event') return carrierEvent(message, sender);
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (!isApp(sender) && !fromPopup) throw new Error('허용된 출고사이트에서만 실행할 수 있습니다.');
  if (message.action === 'ping') return { ok: true, version: '0.6.1' };
  if (message.action === 'status') {
    const jobs = await readJobs(); let changed = false;
    for (const job of jobs) if (['staged', 'registering', 'submitting'].includes(job.state) && job.deadlineAt && Date.now() > job.deadlineAt) {
      job.state = 'unknown'; job.message = '대신의 접수 결과를 확인하지 못했습니다. 화면의 안내와 일자별조회를 확인해 주세요. 자동 재접수하지 않습니다.'; job.updatedAt = new Date().toISOString(); changed = true;
    }
    for (const job of jobs) changed = updateDaesinAcceptedState(job) || changed;
    if (changed) await saveJobs(jobs);
    return { ok: true, version: '0.6.1', jobs: jobs.map(publicJob) };
  }
  if (message.action === 'inspect') return inspect(message.jobId);
  if (message.action === 'report') {
    // Reports must work even if a carrier tab is suspended or a mutation is waiting.
    // Read one saved snapshot; no tab inspection, carrier request or state mutation.
    const saved = await chrome.storage.local.get([KEY, 'sanghwaDailyFetchHistory']);
    return { ok: true, report: { format: 'sanghwa-live-registration/3', version: '0.6.1', generatedAt: new Date().toISOString(), collection: 'saved-extension-state', activeOperation,
      jobs: (saved[KEY] || []).map(job => ({ ...publicJob(job), diagnosis: job.diagnosis || {} })),
      fetchHistory: saved.sanghwaDailyFetchHistory || [] } };
  }
  if (message.action === 'fetch-daily' && isApp(sender)) return fetchDaily(message.shipmentDate, sender.tab);
  if (message.action === 'verify') throw new Error('출고사이트의 대신 전산데이터 새로고침을 사용해 주세요.');
  if (message.action === 'stage' && isApp(sender)) return stage(message, sender.tab);
  throw new Error('지원하지 않는 요청입니다.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Serialize writes, but let read-only diagnostics bypass a stalled carrier operation.
  const readOnly = message.type !== 'carrier-event' && ['ping', 'report'].includes(message.action);
  const run = readOnly ? handle(message, sender) : serial.then(async () => {
    activeOperation = { action: message.action || message.type, startedAt: new Date().toISOString() };
    try { return await handle(message, sender); }
    finally { activeOperation = null; }
  });
  if (!readOnly) serial = run.catch(() => {});
  run.then(reply, error => reply({ ok: false, error: error.message || String(error) }));
  return true;
});
