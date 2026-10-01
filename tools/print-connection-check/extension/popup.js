"use strict";
const STORAGE_KEY="sanghwaPrintConnectionV1";
const inspectButton=document.querySelector("#inspect");
const saveButton=document.querySelector("#save");
const message=document.querySelector("#message");
let reports={};
function renderReports() {
  for (const [carrier,id] of [["대신","daesin"],["로젠","logen"]]) {
    const el=document.getElementById(id);
    const report=reports[carrier];
    const found=report?.frames.some(frame=>frame.buttons.length>0);
    el.textContent=report ? (found ? "확인됨" : "화면 확인 필요") : "확인 전";
    el.classList.toggle("done",Boolean(found));
  }
  saveButton.disabled=!Object.keys(reports).length;
}
function showMessage(text,error=false) { message.textContent=text; message.classList.toggle("error",error); }
async function loadReports() {
  const stored=await chrome.storage.local.get(STORAGE_KEY);
  reports=stored[STORAGE_KEY] || {};
  renderReports();
}
inspectButton.addEventListener("click",async()=>{
  inspectButton.disabled=true;
  showMessage("현재 화면을 확인하고 있습니다…");
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab?.url || "about:blank");
    if(url.protocol!=="https:" || !["partner.ds3211.co.kr","logis.ilogen.com"].includes(url.hostname)) throw new Error("대신 또는 로젠 전산 사이트를 열고 다시 눌러 주세요.");
    const [injection]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:inspectPrintConnection});
    const report=injection?.result;
    if(!report || report.format!=="sanghwa-print-connection/1" || !report.frames?.length) throw new Error("화면 정보를 읽지 못했습니다. 전산 사이트의 로그인 상태를 확인해 주세요.");
    reports[report.carrier]=report;
    await chrome.storage.local.set({[STORAGE_KEY]:reports});
    renderReports();
    const found=report.frames.some(frame=>frame.buttons.length>0);
    showMessage(found ? `${report.carrier} 화면 확인이 끝났습니다. 두 곳을 확인한 뒤 결과 파일을 저장해 주세요.` : `${report.carrier} 정보는 저장했지만 출력 버튼을 찾지 못했습니다. 목록 또는 운송장 미리보기 화면에서 다시 확인해 주세요.`,!found);
  } catch(error) {
    showMessage(error instanceof Error ? error.message : "확인 중 오류가 발생했습니다.",true);
  } finally { inspectButton.disabled=false; }
});
saveButton.addEventListener("click",()=>{
  const data={format:"sanghwa-print-connection-bundle/1",createdAt:new Date().toISOString(),reports};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download="운송장_연결확인.json";document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showMessage("저장한 ‘운송장_연결확인.json’ 파일을 이 대화에 첨부해 주세요.");
});
loadReports().catch(()=>showMessage("저장된 확인 결과를 읽지 못했습니다. 다시 확인해 주세요.",true));
