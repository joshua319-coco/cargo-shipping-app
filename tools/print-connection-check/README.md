# Printer connection discovery

Read-only, user-invoked Chrome/Edge extension to identify the existing carrier print integration before implementing automatic waybill printing.

## Known setup

- Daesin: `partner.ds3211.co.kr`, BIXOLON Web Print SDK 2.0.6, SLP-DL410, logical printer `Printer1`. The existing Print button prints without a further dialog.
- Logen: `logis.ilogen.com`, `(신)감열B` preview followed by confirmation and printer dialog, printer `PS100`.
- Printers are connected to a different PC without Codex.

## Requested printing behavior (not implemented by this tool)

Every PDA false-to-true transition, including bulk and completion actions, requests printing. Existing true values do not produce another request. Uncheck then recheck allows a reprint after the user's confirmation. Browser refresh and synchronization must not create new print requests. The carrier and actual waybill must be bound to each request, and delivery/retry handling must not silently duplicate prints.

## Discovery tool

The extension uses only `activeTab`, `scripting`, and `storage`. It has no host permissions, background worker, content script, network requests, print calls, cookie access, or page storage access. Clicking its action and then the inspection button is required. Only the two exact HTTPS carrier hosts are accepted. It inspects same-origin frames, script paths, allowlisted print-button labels and callee names, and module/method names. Query strings are removed except the known Daesin route keys; inline handler literals are discarded. It does not collect shipment rows, input values, full page HTML, screenshots, module object contents, or credentials.

Reports are retained in extension-local storage and exported by the user as one JSON file. This file is needed to locate carrier-owned print entry points and report-viewer integration. It is not proof of successful printing or a replacement for testing on the printer PC.

Run `package.ps1` from PowerShell to produce `public/print-setup/index.html` and `public/print-setup/cargo-print-connection-check.zip`. Source and the distributed archive should be kept in sync. The guide is also included in the archive for offline setup.
