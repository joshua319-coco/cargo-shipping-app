/* Runs in Chrome's ISOLATED world with the bundled Acorn parser. No page code is executed. */
function inspectRegistrationConnection() {
  "use strict";
  const current = new URL(location.href);
  if (current.origin !== "https://partner.ds3211.co.kr" || current.pathname !== "/issueSvl" ||
      current.searchParams.get("svcGid") !== "customer.issue" || current.searchParams.get("svcSid") !== "excelIssuWay") {
    throw new Error("대신 엑셀일괄발행 화면을 열어 주세요.");
  }
  if (typeof acorn === "undefined" || typeof acorn.parse !== "function") throw new Error("분석 도구를 읽지 못했습니다. 확장 프로그램을 새로고침해 주세요.");
  const id = value => typeof value === "string" && /^[A-Za-z_$][\w$.:\-]{0,99}$/.test(value) && !/\d{7,}/.test(value) ? value : null;
  const service = value => typeof value === "string" && /^[a-zA-Z_][a-zA-Z_.-]{0,79}$/.test(value) ? value : null;
  const routeKeys = new Set(["svcGid", "svcSid"]);
  const caps = { scripts: 120, sourceChars: 4000000, nodes: 180000, events: 6000 };
  const limits = new Set();
  let nodes = 0, eventCount = 0, sourceChars = 0, parsed = 0;
  const parseErrors = [], flows = [], endpoints = new Set();
  function safeUrl(raw, script = false) {
    if (typeof raw !== "string" || raw.length > 1200) return null;
    try {
      const url = new URL(raw, current);
      if (url.origin !== current.origin || !/^\/[A-Za-z0-9_./-]{1,240}$/.test(url.pathname) || /\d{7,}|[A-Za-z0-9_-]{40,}/.test(url.pathname)) return null;
      if (script ? !/\.js$/i.test(url.pathname) : !/(?:Svl|\.do|\.json|\.jsp)$/i.test(url.pathname)) return null;
      const params = new URLSearchParams();
      for (const key of routeKeys) { const value = service(url.searchParams.get(key)); if (value) params.set(key, value); }
      return url.origin + url.pathname + (params.size ? "?" + params.toString() : "");
    } catch { return null; }
  }
  function selector(value) {
    if (typeof value !== "string" || value.length > 160 || /\d{7,}/.test(value)) return null;
    // Only technical IDs/classes/tags and name/type attributes; never arbitrary attribute values or text selectors.
    return /^(?:[#.]?[A-Za-z_][\w-]*(?::(?:checked|selected|visible|hidden))?|\[(?:name|type)=['"]?[A-Za-z_][\w-]*['"]?\])(?:[ >+,]+(?:[#.]?[A-Za-z_][\w-]*(?::(?:checked|selected|visible|hidden))?|\[(?:name|type)=['"]?[A-Za-z_][\w-]*['"]?\]))*$/.test(value) ? value : null;
  }
  function keyOf(node) {
    if (!node) return null;
    return node.type === "Identifier" ? id(node.name) : node.type === "Literal" ? id(node.value) : null;
  }
  function nameOf(node, depth = 0) {
    if (!node || depth > 8) return null;
    if (node.type === "Identifier") return id(node.name);
    if (node.type === "ThisExpression") return "this";
    if (node.type === "MemberExpression") return [nameOf(node.object, depth + 1) || "[expression]", keyOf(node.property) || "[key]"].join(".");
    if (node.type === "CallExpression") return (nameOf(node.callee, depth + 1) || "[function]") + "()";
    if (node.type === "ChainExpression") return nameOf(node.expression, depth + 1);
    return null;
  }
  function routeTarget(node) {
    if (!node) return null;
    if (node.type === "Identifier" && routeKeys.has(node.name)) return node.name;
    if (node.type === "MemberExpression") {
      const key = keyOf(node.property);
      if (routeKeys.has(key)) return key;
      if (key === "value") return routeTarget(node.object);
    }
    if (node.type === "CallExpression") {
      const last = node.arguments?.[0];
      const value = last?.type === "Literal" && typeof last.value === "string" ? last.value : "";
      const match = value.match(/(?:^|[#.\s])(?:svcGid|svcSid)$/);
      if (match && ["$", "jQuery", "document.getElementById"].includes(nameOf(node.callee))) return value.endsWith("svcGid") ? "svcGid" : "svcSid";
    }
    return null;
  }
  function literal(node, context) {
    if (typeof node.value !== "string") return { type: typeof node.value };
    const value = node.value;
    if (routeKeys.has(context) && service(value)) return { service: value };
    if (context === "selector" && selector(value)) return { selector: value };
    if (context === "field" && id(value)) return { field: value };
    if (["method", "type"].includes(context) && /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/i.test(value)) return { method: value.toUpperCase() };
    if (context === "enctype" && ["multipart/form-data", "application/x-www-form-urlencoded", "application/json"].includes(value)) return { encoding: value };
    if (["url", "action", "endpoint"].includes(context)) {
      const url = safeUrl(value); if (url) { endpoints.add(url); return { url }; }
    }
    return { type: "string", omitted: true };
  }
  function shape(node, context, depth = 0) {
    if (!node || depth > 7) return { type: node?.type || "none" };
    if (node.type === "Literal") return literal(node, context);
    if (["Identifier", "MemberExpression", "ThisExpression"].includes(node.type)) return { ref: nameOf(node) };
    if (node.type === "ObjectExpression") return { fields: node.properties.slice(0,70).map(p => ({ key: p.computed ? null : keyOf(p.key), value: shape(p.value || p.argument, p.computed ? null : keyOf(p.key), depth + 1) })) };
    if (node.type === "ArrayExpression") return { type: "ArrayExpression" }; // Could contain complete shipment rows.
    if (/FunctionExpression$/.test(node.type)) return { callback: id(node.id?.name), line: node.loc?.start.line };
    if (["CallExpression", "NewExpression"].includes(node.type)) {
      const callee = nameOf(node.callee);
      const member = node.callee.type === "MemberExpression" ? keyOf(node.callee.property) : null;
      return { call: callee, args: node.arguments.slice(0,12).map((arg, index) => {
        let argContext = null;
        if (index === 0 && ["$", "jQuery", "document.querySelector", "document.querySelectorAll"].includes(callee)) argContext = "selector";
        if (index === 0 && ["document.getElementById", "document.getElementsByName"].includes(callee)) argContext = "field";
        if (index === 0 && ["append", "set", "get", "attr", "prop", "getAttribute", "setAttribute"].includes(member)) argContext = "field";
        if (index === 0 && ["$.post", "$.get", "jQuery.post", "jQuery.get", "fetch"].includes(callee)) argContext = "endpoint";
        if (member === "open" && index === 0) argContext = "method";
        if (member === "open" && index === 1) argContext = "endpoint";
        if (member === "val" && index === 0) argContext = routeTarget(node.callee.object);
        if (index === 1 && ["attr", "prop", "setAttribute", "append", "set"].includes(member)) {
          const key = node.arguments[0]?.type === "Literal" ? node.arguments[0].value : null;
          if (routeKeys.has(key) || ["action", "method", "enctype"].includes(key)) argContext = key;
        }
        return shape(arg, argContext, depth + 1);
      }) };
    }
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") return { type: node.type, operator: node.operator, left: shape(node.left, context, depth + 1), right: shape(node.right, context, depth + 1) };
    if (node.type === "ConditionalExpression") return { type: node.type, test: shape(node.test, null, depth + 1), yes: shape(node.consequent, context, depth + 1), no: shape(node.alternate, context, depth + 1) };
    return { type: node.type };
  }
  function add(flow, event) {
    if (++eventCount <= caps.events) flow.events.push(event); else limits.add("events");
  }
  function walk(node, flow, parent, depth = 0) {
    if (!node || typeof node.type !== "string") return;
    if (++nodes > caps.nodes || depth > 100) { limits.add("nodes/depth"); return; }
    const line = node.loc?.start.line;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      const inferred = node.id ? nameOf(node.id) : parent?.type === "VariableDeclarator" ? nameOf(parent.id) : parent?.type === "AssignmentExpression" ? nameOf(parent.left) : parent?.type === "Property" ? keyOf(parent.key) : null;
      const child = { script: flow.script, name: inferred || "[callback]", line, parent: flow.name, params: node.params.map(p => nameOf(p) || "[pattern]"), events: [] };
      flows.push(child);
      for (const p of node.params) walk(p, child, node, depth + 1);
      walk(node.body, child, node, depth + 1);
      return;
    }
    if (["CallExpression", "NewExpression"].includes(node.type)) add(flow, { line, ...shape(node) });
    if (["AssignmentExpression", "VariableDeclarator"].includes(node.type)) {
      const left = node.left || node.id, right = node.right || node.init;
      const key = keyOf(left?.property || left);
      const context = routeTarget(left) || (["url", "action", "method", "type", "enctype"].includes(key) ? key : null);
      if (right && right.type !== "ArrayExpression") add(flow, { line, assign: nameOf(left), value: shape(right, context) });
    }
    // Also find route strings in concatenated endpoint expressions, without keeping any other strings.
    if (node.type === "Literal" && typeof node.value === "string" && /(?:Svl|\.do|\.json|\.jsp)(?:\?|$)/i.test(node.value)) {
      const url = safeUrl(node.value); if (url) endpoints.add(url);
    }
    for (const key of Object.keys(node)) {
      if (["loc", "start", "end", "raw", "value", "regex"].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) { for (const item of child) if (item?.type) walk(item, flow, node, depth + 1); }
      else if (child?.type) walk(child, flow, node, depth + 1);
    }
    // Literal values are skipped above; Property.value is a syntax node, not a literal value.
    if (node.type === "Property" && node.value?.type) walk(node.value, flow, node, depth + 1);
  }
  function analyze(source, script, sourceType = "script") {
    if (!source?.trim()) return;
    sourceChars += source.length;
    if (sourceChars > caps.sourceChars) { limits.add("sourceChars"); return; }
    try {
      const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType, locations: true, allowReturnOutsideFunction: true });
      parsed++;
      const flow = { script, name: "[top level]", events: [] }; flows.push(flow); walk(ast, flow, null);
    } catch (error) { parseErrors.push({ script, line: Number.isInteger(error.loc?.line) ? error.loc.line : null }); }
  }
  const fields = element => ({ tag: element.tagName.toLowerCase(), type: id(element.getAttribute("type")), id: id(element.id), name: id(element.getAttribute("name")) });
  const formElements = [...document.querySelectorAll("form")].slice(0,50);
  const forms = formElements.map(el => ({ id: id(el.id), name: id(el.getAttribute("name")), action: safeUrl(el.getAttribute("action")), method: /^(get|post)$/i.test(el.getAttribute("method") || "") ? el.getAttribute("method").toUpperCase() : null, enctype: ["multipart/form-data", "application/x-www-form-urlencoded", "text/plain"].includes(el.getAttribute("enctype")) ? el.getAttribute("enctype") : null, fields: [...el.querySelectorAll("input,select,textarea,button")].slice(0,200).map(fields) }));
  const fileInputs = [...document.querySelectorAll('input[type="file"]')].slice(0,20).map(el => ({ ...fields(el), form: id(el.getAttribute("form")) || id(el.form?.id) }));
  const buttons = [];
  const labels = /^(?:\d+\s*[.．]\s*)?(?:파일\s*찾기|샘플\s*파일\s*다운로드|등록\s*안내|(?:일괄\s*)?(?:등록|저장|업로드|변환|검증)|엑셀\s*(?:등록|업로드|저장)|확인|삭제)$/;
  for (const el of [...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]')].slice(0,2000)) {
    const label = String(el.tagName === "INPUT" ? el.getAttribute("value") || "" : el.textContent || "").replace(/\s+/g," ").trim();
    if (!labels.test(label)) continue;
    const index = buttons.length; buttons.push({ ...fields(el), label });
    for (const attr of ["onclick", "onmousedown"]) analyze(el.getAttribute(attr), `button:${index}:${attr}`);
    const href = el.getAttribute("href"); if (href?.startsWith("javascript:")) analyze(href.slice(11), `button:${index}:href`);
  }
  for (const [index, el] of [...document.querySelectorAll('input[type="file"],form')].slice(0,70).entries()) {
    for (const attr of ["onchange", "onsubmit"]) analyze(el.getAttribute(attr), `control:${index}:${attr}`);
  }
  const inlineScripts = [...document.querySelectorAll("script:not([src])")].filter(el => !el.type || /^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(el.type));
  if (inlineScripts.length > caps.scripts) limits.add("scripts");
  inlineScripts.slice(0,caps.scripts).forEach((el,index) => analyze(el.textContent, `inline:${index}`, el.type === "module" ? "module" : "script"));
  const meaningful = fileInputs.length > 0 && parsed > 0 && (endpoints.size > 0 || flows.some(f => f.events.some(e => e.call && /ajax|submit|post|upload|excel|file/i.test(e.call))));
  return {
    format: "sanghwa-registration-connection/1", version: "0.2.0", carrier: "대신", capturedAt: new Date().toISOString(),
    url: safeUrl(current.href), status: meaningful && !parseErrors.length && !limits.size ? "captured" : "partial",
    forms, fileInputs, buttons, scripts: [...new Set([...document.querySelectorAll("script[src]")].slice(0,200).map(el => safeUrl(el.getAttribute("src"), true)).filter(Boolean))],
    endpoints: [...endpoints], flows, analysis: { inlineScripts: inlineScripts.length, parsed, parseErrors, limits: [...limits] },
    collection: "Read-only syntax summary: technical field/function names, allowlisted service routes, calls and callbacks. No input values, shipment rows, general literals, raw code, cookies, storage, network requests, registration or print calls."
  };
}
