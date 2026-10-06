'use strict';
importScripts('carrier-functions.js');
const APP = 'http://127.0.0.1:4320', CARRIER = 'https://partner.ds3211.co.kr';
const REGISTER = CARRIER + '/issueSvl?svcGid=customer.issue&svcSid=excelIssuWay';
const DAILY = CARRIER + '/searchSvl?svcGid=customer.search&svcSid=dailySearch';
const KEY = 'sanghwaLiveRegistrationJobs';
let staging = false, serial = Promise.resolve();
const readJobs = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
const saveJobs = jobs => chrome.storage.local.set({ [KEY]: jobs });
const publicJob = job => job ? { id: job.id, shipmentId: job.shipmentId, shipmentDate: job.shipmentDate, receiver: job.receiver, state: job.state, numbers: job.numbers || [], message: job.message || '', updatedAt: job.updatedAt, tabId: job.tabId } : null;
function isApp(sender) { try { return sender.frameId === 0 && new URL(sender.url).origin === APP; } catch { return false; } }
async function waitForTab(tabId) {
  for (let i = 0; i < 40; i++) { const tab = await chrome.tabs.get(tabId); if (tab.status === 'complete' && tab.url?.startsWith(CARRIER + '/')) return tab; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error('대신 화면을 여는 시간이 초과됐습니다. 접수 결과를 자동으로 재시도하지 않습니다.');
}
async function stage(request) {
  if (staging) throw new Error('다른 전송이 진행 중입니다.');
  staging = true;
  try {
    const p = request.payload;
    if (!p || typeof p.workbook !== 'string' || p.workbook.length > 1400000 || !/^[A-Za-z0-9+/]+=*$/.test(p.workbook) || !/^\d+$/.test(p.shipmentId) || !/^[a-f0-9]{64}$/.test(p.fingerprint) || typeof p.receiver !== 'string' || !p.receiver.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(p.shipmentDate)) throw new Error('출고 1건의 전송정보를 확인할 수 없습니다.');
    if (p.shipmentDate !== '2026-10-06' || !/^대신자동업로드테스트[123]$/.test(p.receiver.trim())) throw new Error('2026-10-06 대신자동업로드테스트1·2·3만 전송할 수 있습니다.');
    let jobs = await readJobs();
    const previous = jobs.find(job => job.shipmentId === p.shipmentId);
    if (previous) { if (previous.tabId) await chrome.tabs.update(previous.tabId, { active: true }).catch(() => {}); return { ok: true, job: publicJob(previous), repeated: true }; }
    const job = { id: crypto.randomUUID(), nonce: crypto.randomUUID(), shipmentId: p.shipmentId, shipmentDate: p.shipmentDate, fingerprint: p.fingerprint, receiver: p.receiver, state: 'opening', updatedAt: new Date().toISOString() };
    const source = p.source || {};
    job.diagnosis = { source: Object.fromEntries(['postalCode', 'address', 'branch', 'quantity', 'fare', 'delivery'].filter(key => ['string', 'number'].includes(typeof source[key])).map(key => [key, String(source[key]).slice(0, 500)])) };
    jobs.push(job); await saveJobs(jobs);
    try {
      const tab = await chrome.tabs.create({ url: REGISTER, active: true });
      job.tabId = tab.id; job.state = 'opening'; await saveJobs(jobs);
      await waitForTab(tab.id);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: installCarrierRelay, args: [job.id, job.nonce] });
      job.state = 'staged'; job.message = '대신 화면에서 변환된 1건을 확인한 뒤 최종 등록을 진행해 주세요.'; await saveJobs(jobs);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: stageCarrierWorkbook, args: [{ workbook: p.workbook, nonce: job.nonce }] });
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
    job.diagnosis.upload = { rowCount: d.rowCount, destinations: d.destinations };
    await readDestination(job);
  }
  if (d.kind === 'registration-response') {
    const numbers = Array.isArray(d.numbers) ? d.numbers.filter(number => /^\d{12}$/.test(number)) : [];
    job.numbers = [...new Set(numbers)]; job.state = job.numbers.length === 1 ? 'response-received' : 'needs-review';
    job.message = job.numbers.length === 1 ? '대신이 실제 송장번호를 응답했습니다. 일자별조회에서 같은 번호와 수화주명을 확인해 주세요.' : '접수 응답은 받았지만 송장번호 1건을 확인하지 못했습니다. 자동으로 다시 접수하지 않습니다.';
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
  if (job.submissionStarted || !['staged', 'carrier-review', 'needs-review'].includes(job.state) || job.numbers?.length) return;
  const missing = job.diagnosis.readError ? null : job.diagnosis.destination?.missingDestinationCount;
  job.state = missing === 0 && job.diagnosis.upload?.rowCount === 1 ? 'carrier-review' : 'needs-review';
  job.message = missing > 0 ? '대신에서 도착지 미지정 ' + missing + '건이 표시됩니다. 대신 화면의 도착지를 확인·수정하고 ‘도착지 다시 확인’을 눌러 주세요.'
    : job.state === 'carrier-review' ? '대신에서 1건을 읽었고 도착지 미지정은 0건입니다. 수량·운임·도착지를 확인한 뒤 대신의 등록 버튼으로 접수해 주세요.'
    : '업로드 결과의 도착지 지정 여부를 확인하지 못했습니다. 대신 화면을 확인하고 확인결과 파일을 저장해 주세요.';
}
async function inspect(jobId) {
  const jobs = await readJobs(), job = jobs.find(item => item.id === jobId);
  if (!job?.tabId) throw new Error('전송했던 대신 등록 화면이 필요합니다.');
  await readDestination(job); job.updatedAt = new Date().toISOString(); await saveJobs(jobs);
  return { ok: true, job: publicJob(job) };
}
async function verify(jobId) {
  const jobs = await readJobs(), job = jobs.find(item => item.id === jobId);
  if (!job || job.numbers?.length !== 1) throw new Error('대신이 응답한 송장번호 1건이 먼저 필요합니다.');
  const tabs = await chrome.tabs.query({ url: CARRIER + '/searchSvl*' });
  for (const tab of tabs.filter(tab => new URL(tab.url).searchParams.get('svcSid') === 'dailySearch')) {
    const [check] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: findCarrierWaybill, args: [job.numbers[0], job.receiver] });
    if (check?.result?.found) { job.state = 'verified'; job.message = '대신 일자별조회에서 실제 송장번호와 수화주명이 일치하는 출고 1건을 확인했습니다.'; job.updatedAt = new Date().toISOString(); await saveJobs(jobs); return { ok: true, job: publicJob(job) }; }
  }
  const existing = tabs.find(tab => new URL(tab.url).searchParams.get('svcSid') === 'dailySearch');
  if (existing) await chrome.tabs.update(existing.id, { active: true }); else await chrome.tabs.create({ url: DAILY, active: true });
  return { ok: false, error: '대신 일자별조회에서 해당 접수일자를 조회한 후 ‘실제 등록 확인’을 다시 눌러 주세요.' };
}
async function handle(message, sender) {
  if (message.type === 'carrier-event') return carrierEvent(message, sender);
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (!isApp(sender) && !fromPopup) throw new Error('허용된 테스트 화면에서만 실행할 수 있습니다.');
  if (message.action === 'ping') return { ok: true, version: '0.2.0' };
  if (message.action === 'status') return { ok: true, version: '0.2.0', jobs: (await readJobs()).map(publicJob) };
  if (message.action === 'inspect') return inspect(message.jobId);
  if (message.action === 'report') return { ok: true, report: { format: 'sanghwa-live-registration/2', version: '0.2.0', generatedAt: new Date().toISOString(), jobs: (await readJobs()).map(job => ({ ...publicJob(job), diagnosis: job.diagnosis || {} })) } };
  if (message.action === 'verify') return verify(message.jobId);
  if (message.action === 'stage' && isApp(sender)) return stage(message);
  throw new Error('지원하지 않는 요청입니다.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Serialize persisted state mutations so a response cannot overwrite another job update.
  const run = serial.then(() => handle(message, sender));
  serial = run.catch(() => {});
  run.then(reply, error => reply({ ok: false, error: error.message || String(error) }));
  return true;
});
