/* Read-only, self-contained function injected only after an explicit popup click. */
function inspectPrintConnection() {
  "use strict";
  const allowedHosts = new Set(["partner.ds3211.co.kr", "logis.ilogen.com"]);
  if (location.protocol !== "https:" || !allowedHosts.has(location.hostname)) {
    throw new Error("대신 또는 로젠 전산 화면에서 실행해 주세요.");
  }
  const carrier = location.hostname === "partner.ds3211.co.kr" ? "대신" : "로젠";
  const modulePattern = /(?:print|printer|bixolon|bxl|ozviewer|ozreport|ozweb|start_oz|ibsheet|sheet\d*$)/i;
  const buttonPattern = /^(?:\d+\s*[.．]\s*)?(?:프린트|인쇄|운송장\s*출력|옵션\s*적용|출력|Print|PRINT)$/;
  const redactPath = (path) => path.replace(/\d{7,}/g, "[number]").replace(/[a-zA-Z0-9_-]{40,}/g, "[token]");
  function safeUrl(raw, base) {
    if (!raw) return null;
    try {
      const url = new URL(raw, base);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      const params = new URLSearchParams();
      for (const key of ["svcGid", "svcSid"]) {
        const value = url.searchParams.get(key);
        if (value && /^[a-zA-Z_.-]{1,100}$/.test(value)) params.set(key, value);
      }
      const query = params.toString();
      return `${url.origin}${redactPath(url.pathname)}${query ? "?" + query : ""}`;
    } catch { return null; }
  }
  function identifier(value) {
    return typeof value === "string" && /^[A-Za-z_$][\w$.:-]{0,99}$/.test(value) && !/\d{7,}/.test(value) ? value : null;
  }
  function calledFunctions(code) {
    // Discard every literal/comment before looking for callee names.
    // Handler arguments may contain shipment numbers or other personal data.
    const source=String(code || "");
    let structure="", quote="", comment="";
    for(let i=0;i<source.length;i++) {
      const c=source[i], next=source[i+1];
      if(comment==="line") { if(c==="\n") {comment="";structure+="\n";} continue; }
      if(comment==="block") { if(c==="*" && next==="/") {comment="";i++;} continue; }
      if(quote) { if(c==="\\") {i++;continue;} if(c===quote) quote=""; continue; }
      if(c==='"' || c==="'" || c==='`') {quote=c;structure+=" ";continue;}
      if(c==="/" && next==="/") {comment="line";i++;continue;}
      if(c==="/" && next==="*") {comment="block";i++;continue;}
      structure+=c;
    }
    return [...new Set([...structure.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)]
      .map((match) => identifier(match[1])).filter(Boolean))].slice(0,20);
  }
  function callableNames(object) {
    const names = new Set();
    try {
      for (let depth=0, current=object; current && depth<2; depth++, current=Object.getPrototypeOf(current)) {
        for (const name of Object.getOwnPropertyNames(current).slice(0,1500)) {
          const descriptor = Object.getOwnPropertyDescriptor(current, name);
          if (identifier(name) && descriptor && "value" in descriptor && typeof descriptor.value === "function") names.add(name);
        }
      }
    } catch { /* Cross-origin or protected objects stay unread. */ }
    return [...names].sort().slice(0,100);
  }
  const frames = [];
  const visited = new Set();
  function inspectFrame(win, depth, inheritedBase) {
    if (depth > 5 || frames.length >= 30 || visited.has(win)) return;
    visited.add(win);
    let doc;
    let base;
    try {
      doc = win.document;
      const inherited=/^about:(?:blank|srcdoc)$/.test(win.location.href) && inheritedBase;
      if (!inherited && (!allowedHosts.has(win.location.hostname) || win.location.protocol !== "https:")) return;
      base=inherited ? inheritedBase : win.location.href;
    } catch { return; }
    const frame = {
      depth,
      url: safeUrl(win.location.href,base) || "about:blank",
      scripts: [],
      buttons: [],
      modules: [],
      viewers: [],
      childFrames: [],
    };
    frames.push(frame);
    frame.scripts = [...new Set([...doc.querySelectorAll("script[src]")].slice(0,250)
      .map((el) => safeUrl(el.getAttribute("src"), doc.baseURI || base)).filter(Boolean))];
    for (const el of [...doc.querySelectorAll("button,a,input[type=button],input[type=submit],[role=button]")].slice(0,2500)) {
      // Only exact, known UI labels; never read form fields or table rows.
      const label = String(el.tagName === "INPUT" ? el.getAttribute("value") || "" : el.textContent || "").replace(/\s+/g," ").trim();
      if (!buttonPattern.test(label)) continue;
      const listeners = [];
      for (const eventName of ["onclick", "onmousedown"]) {
        for (const name of calledFunctions(el.getAttribute(eventName))) listeners.push(name);
      }
      const calls = calledFunctions(el.getAttribute("href")?.startsWith("javascript:") ? el.getAttribute("href") : "");
      frame.buttons.push({label, tag:el.tagName.toLowerCase(), id:identifier(el.id), name:identifier(el.getAttribute("name")), calls:[...new Set([...listeners,...calls])]});
    }
    let globals = [];
    try { globals = Object.getOwnPropertyNames(win).slice(0,6000); } catch { /* no-op */ }
    for (const name of globals) {
      if (!identifier(name) || !modulePattern.test(name)) continue;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(win,name);
        if (!descriptor || !("value" in descriptor)) continue; // Never run a getter.
        const value = descriptor.value;
        const kind = value === null ? "null" : typeof value;
        frame.modules.push({name, kind, methods:kind === "object" || kind === "function" ? callableNames(value) : []});
      } catch { /* no-op */ }
      if (frame.modules.length >= 150) break;
    }
    for (const el of [...doc.querySelectorAll("object,embed,[id*='OZ'],[id*='ozviewer'],[id*='ozViewer']")].slice(0,40)) {
      const id = identifier(el.id);
      if (!id && !["OBJECT","EMBED"].includes(el.tagName)) continue;
      frame.viewers.push({tag:el.tagName.toLowerCase(),id,type:/^[\w/+.-]{1,80}$/.test(el.getAttribute("type") || "") ? el.getAttribute("type") : null,methods:callableNames(el)});
    }
    for (const el of [...doc.querySelectorAll("iframe,frame")].slice(0,40)) {
      const url = safeUrl(el.getAttribute("src"),base);
      let readable = false;
      try { readable=Boolean(el.contentWindow.document) && (allowedHosts.has(el.contentWindow.location.hostname) || /^about:(?:blank|srcdoc)$/.test(el.contentWindow.location.href)); } catch { /* no-op */ }
      frame.childFrames.push({id:identifier(el.id),url,readable});
      if (readable) inspectFrame(el.contentWindow,depth+1,base);
    }
  }
  inspectFrame(window,0);
  return {
    format:"sanghwa-print-connection/1",
    carrier,
    capturedAt:new Date().toISOString(),
    browserVersion:(navigator.userAgent.match(/(?:Chrome|Edg)\/[\d.]+/g) || []).join(" "),
    frames,
    collection:"UI labels, script paths, callable names only; no shipment rows, form values, cookies, storage, or print calls.",
  };
}
