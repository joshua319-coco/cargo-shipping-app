# Daesin live registration connection test

This is a local, one-shipment integration test, separate from the static demo and from production deployment. Run the existing Next app on `127.0.0.1:4320` and open `/?registrationTest=1&shipmentDate=2026-10-06` in Chrome. The page uses the existing application and its normal authenticated data access.

The helper is loaded unpacked from `extension/`. The local setup page is `/registration-test-setup/index.html`. It preserves the real shipment list and manual checklist. Its controls appear only in development on the exact loopback origin with the explicit test query.

## Flow

1. Review one selected Daesin shipment. The same production `toTemplateRow` conversion generates an in-memory workbook (internal 0.5 becomes one box, with the fare unchanged).
2. The helper opens a fresh Daesin Excel registration tab, provides the workbook to the observed `waybillFrm/input-file` input and dispatches its file-change handler.
3. The user reviews the carrier's converted row and uses the carrier's native final registration action. The helper does not click registration or printing buttons.
4. Observe only the known `insertFixUnsongApply` response's `resultBillNos` field. A single returned number is still awaiting verification.
5. Check the visible daily-search table for the exact 12-digit number and recipient. Only that match sets `verified` in local helper state.

## Bounds and limits

- No automatic registration, printing, background retry, or production database write-back is implemented by this helper.
- The application still shares its normal live database. Existing app save/delete/checklist controls retain their usual behavior.
- The helper persists job identity, recipient, carrier tab, state, returned number and the whitelisted destination diagnostics locally; it does not persist workbook contents or access login credentials.
- Once a shipment has been staged, repeated requests open its existing result and do not stage it again. Ambiguous outcomes require manual review in Daesin. This first version has no automatic recovery/reset of a failed or expired session.
- Browser-level tests intercept carrier traffic with local fixtures. They verify workbook transfer, observed response handling, recipient/number comparison, and duplicate/timeout behavior. They do not establish that live Daesin has accepted a shipment.
- Live carrier acceptance, its result-field representation and user-account-specific upload/print settings must be checked in the first actual trial. The final carrier action remains manual for that reason.
- No Logen registration API or same-number printing integration is included here.

## Validation completed

- TypeScript check and 23 existing/business-rule tests, including half-box XLSX round-trip with unchanged fare.
- Isolated MV3 helper tests: input bytes, single change event, one-row upload response, no automatic submit, duplicate suppression, response received versus daily-query verified, wrong recipient rejected, unknown outcome not resubmitted.
- Actual Next UI with mocked API: original waybill checkbox retained, quantity rounded for display, no-helper transfer blocked, no DB writes, no browser exceptions.

The test extension is intentionally not merged into or deployed to production.

## Version 0.2.0

Only the three Daesin recipients 대신자동업로드테스트1/2/3 dated 2026-10-06 are eligible, one per transfer. Database IDs may change when records are recreated. Old shipmentId query parameters are ignored. Both page and helper enforce the named test scope.

Wait for the observed excelFormClass configuration and idle jQuery requests before triggering the carrier file handler. This addresses a possible settings race; it does not prove or fix the reported destination-mapping cause. Read the known span_not-selectedAgency counter rather than guessing destination codes. A one-row upload alone is no longer treated as destination-ready. A read-only recheck never retransmits or demotes an ambiguous/submitted result.

User-requested JSON diagnostics contain only source destination/quantity/fare, carrier destination-field values, format and checkbox settings, job metadata and numbers. They exclude credentials, full workbooks, sender details and phone numbers. Local job history is removed if the extension is uninstalled; existing carrier registrations must be checked before starting again.

0.2.0 validation: TypeScript and 23 rule tests passed. Isolated MV3 tests passed for recreated IDs/named scope, delayed configuration readiness, missing-destination detection/recheck, field-whitelist diagnostics, duplicate suppression, exact waybill/recipient verification, and unknown response preservation. Actual Next UI was checked with a stale old-ID URL and a recreated new-ID fixture; no DB writes or browser exceptions occurred. No actual carrier acceptance is asserted.
