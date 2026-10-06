'use strict';
const jobs = document.querySelector('#jobs'), message = document.querySelector('#message');
async function render() {
  const response = await chrome.runtime.sendMessage({ action: 'status' });
  jobs.replaceChildren();
  for (const job of (response.jobs || []).slice().reverse()) {
    const card = document.createElement('div'); card.className = 'job';
    const name = document.createElement('strong'); name.textContent = job.receiver + ' · ' + job.shipmentDate;
    const info = document.createElement('p'); info.textContent = job.message || '등록 화면 준비 중';
    const number = document.createElement('code'); number.textContent = job.numbers.join(', ');
    const button = document.createElement('button'); button.textContent = job.state === 'verified' ? '대신 목록 확인 완료' : '실제 등록 확인'; button.disabled = job.numbers.length !== 1 || job.state === 'verified';
    button.addEventListener('click', async () => { button.disabled = true; const result = await chrome.runtime.sendMessage({ action: 'verify', jobId: job.id }); message.textContent = result.ok ? result.job.message : result.error; await render(); });
    card.append(name, info, number, button); jobs.append(card);
  }
  if (!response.jobs?.length) jobs.textContent = '아직 대신으로 전송한 출고건이 없습니다.';
}
document.querySelector('#refresh').addEventListener('click', () => render().catch(error => message.textContent = error.message));
render().catch(error => message.textContent = error.message);
