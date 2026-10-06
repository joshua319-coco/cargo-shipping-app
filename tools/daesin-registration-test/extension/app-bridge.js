'use strict';
if (location.origin === 'http://127.0.0.1:4320') {
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'sanghwa-live-request') return;
    const request = event.data;
    if (!['ping', 'stage', 'status', 'verify'].includes(request.action) || typeof request.requestId !== 'string') return;
    let result;
    try { result = await chrome.runtime.sendMessage({ ...request, type: 'app-request' }); }
    catch { result = { ok: false, error: '확장 프로그램을 새로고침한 뒤 이 페이지도 새로고침해 주세요.' }; }
    window.postMessage({ channel: 'sanghwa-live-response', requestId: request.requestId, result }, location.origin);
  });
}
