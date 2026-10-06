# Read-only carrier connection checker

Version 0.2.0 adds a dedicated Daesin Excel registration probe for `/issueSvl?svcGid=customer.issue&svcSid=excelIssuWay`. The previous 0.1.0 print probe did not collect registration controls or inline business logic. A report from that version cannot establish the upload/submit flow.

The extension still requests only `activeTab`, `scripting`, and `storage`. It runs on an explicit click. Print inspection remains unchanged. Registration inspection injects the bundled MIT-licensed Acorn 8.16.0 parser into the extension's ISOLATED world, then parses DOM inline scripts as syntax without evaluating carrier code. It does not make network calls, submit forms, select/upload files, print, or access cookies or page storage.

The exported registration report includes technical form field names, known UI labels, script paths, allowlisted same-origin service routes, and a syntax summary of calls/assignments/callbacks. General string and numeric literals are omitted, as are input values, rows, source text and parse-error messages. Only narrowly allowlisted technical contexts retain service IDs, selectors, request field names, HTTP methods and endpoint paths. Array data is never serialized. Size/node/depth/event limits and parser failures are reported as partial results, not successful registration readiness. Neither captured nor partial status establishes automation feasibility.

Old carrier print reports remain in `sanghwaPrintConnectionV1`. Registration uses a separate `sanghwaRegistrationConnectionV1` entry. Bundle version 2 retains both and downloads as `등록_연결확인.json` when registration data exists. A versioned ZIP avoids downloading a cached old tool; the original ZIP URL is maintained for compatibility.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/print-connection-check/package.ps1` to regenerate the public guide and both ZIP files. Keep the vendor license alongside Acorn. The guide explains overwriting the existing unpacked extension directory and reloading it in `chrome://extensions`.

This is a diagnostic only. It does not implement automatic registration or printing. Reprinting must preserve the existing waybill number; Logen's normal RePrint flow can allocate a new number and must not be used for that requirement.
