'use strict';
const jobs = document.querySelector('#jobs'), message = document.querySelector('#message');
async function render() {
  const response = await chrome.runtime.sendMessage({ action: 'status' });
  jobs.replaceChildren();
  const summary = document.createElement('p');
  summary.textContent = '등록 완료 ' + (response.jobs || []).filter(job => job.numbers.length === 1).length + '건 · 도착지 수정 필요 ' + (response.jobs || []).filter(job => job.numbers.length === 1 && job.destinationNeedsReview).length + '건 · 등록 안됨 ' + (response.jobs || []).filter(job => job.state === 'not-registered').length + '건';
  jobs.append(summary);
  for (const job of (response.jobs || []).slice().reverse()) {
    const card = document.createElement('div'); card.className = 'job';
    const name = document.createElement('strong'); name.textContent = job.receiver + ' · ' + job.shipmentDate;
    const info = document.createElement('p'); info.textContent = job.message || '등록 화면 준비 중';
    const number = document.createElement('code'); number.textContent = job.numbers.join(', ');
    const button = document.createElement('button'); button.textContent = job.state === 'verified' ? '대신 목록 확인 완료' : '실제 등록 확인'; button.disabled = job.numbers.length !== 1 || job.state === 'verified';
    button.addEventListener('click', async () => { button.disabled = true; const result = await chrome.runtime.sendMessage({ action: 'verify', jobId: job.id }); message.textContent = result.ok ? result.job.message : result.error; await render(); });
    const inspect = document.createElement('button'); inspect.textContent = '도착지 다시 확인';
    inspect.addEventListener('click', async () => { inspect.disabled = true; const result = await chrome.runtime.sendMessage({ action: 'inspect', jobId: job.id }); message.textContent = result.ok ? result.job.message : result.error; await render(); });
    card.append(name, info, number, button, inspect); jobs.append(card);
  }
  if (!response.jobs?.length) jobs.textContent = '아직 대신으로 전송한 출고건이 없습니다.';
}
document.querySelector('#refresh').addEventListener('click', () => render().catch(error => message.textContent = error.message));
render().catch(error => message.textContent = error.message);

document.querySelector('#report').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'report' });
    if (!response.ok) throw new Error(response.error);
    const url = URL.createObjectURL(new Blob([JSON.stringify(response.report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '대신_등록테스트_확인결과.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { message.textContent = error.message; }
});
