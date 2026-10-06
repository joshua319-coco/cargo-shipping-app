# Daesin no-print registration test (0.3.0)

Run the existing Next app at `http://127.0.0.1:4320/?registrationTest=1&shipmentDate=2026-10-06`. This local-only development UI shares the authenticated production shipment data, but the helper does not write shipment/waybill records back to the database. It is not deployed to production.

Only a newly requested, single Daesin shipment dated 2026-10-06 with a recipient matching `대신자동업로드테스트` plus a positive integer may run. Existing helper jobs are never automatically replayed after upgrade. Upgrade in place and reload the same extension ID to preserve local history.

## Flow

1. Generate the normal production Excel workbook in memory (half-box rounds up, fare retained).
2. Wait for Daesin's saved upload settings, then trigger its native file-change handler in a fresh tab.
3. Classify the single upload response and current destination fields. Normal agency codes proceed. Shared jurisdiction or unassigned destinations also proceed, recording a post-registration correction requirement. Explicit parcel/freight-unavailable conditions are reported as not registered. Unknown data is held for review.
4. Verify one rendered row matches the requested recipient, quantity and fare. Click that row's `checkN` checkbox, allowing the native handler to update hidden selection fields; verify it stayed checked.
5. Find exactly one visible, enabled button labelled `등록(출력안함)` and click it once. Never substitute the blue `등록` button, guess print-mode parameters, or change the branch/printer configuration. A submission marker prevents collision with a manual submit during the selection step.
6. Observe the known `insertFixUnsongApply` response. One returned 12-digit number is displayed as registered. Warnings remain attached to that job and counted separately. A later daily-search lookup can verify both recipient and number.
7. A missing/ambiguous response stays unknown and is not retried. A persistent deadline is evaluated on status reads, so a suspended service worker cannot leave a job pending indefinitely when the user reopens the UI.

The original read-only diagnosis redacted numeric branch constants, so this helper deliberately uses the observed native no-print button instead of calling `applyUnsong` with a guessed argument. It does not automatically dismiss arbitrary carrier dialogs. Unexpected validation or confirmation UI is left visible and reported as a result needing review.

## Verification

- Business-rule tests cover assigned destinations with a blank warning counter, shared jurisdiction, unassigned destinations, prohibited service and unknown/multiple rows.
- Isolated MV3 browser tests intercept all carrier traffic. Normal/shared/unassigned cases run the native row-selection handler and only the no-print button. Prohibited service, missing no-print button, failed selection, wrong recipient, rejected response and connection failure are separately asserted. The blue button is never clicked, print count remains unchanged, and duplicate requests do not submit again.
- TypeScript and existing carrier/address regression tests pass. These fixtures establish implementation behavior, not live carrier acceptance of the new automatic-click step.
- Before 0.3.0, the user confirmed the in-memory upload works against Daesin and explained that joint jurisdiction/unassigned routes remain registerable, with manual destination corrections in 마감관리 after registration. The user explicitly requires row selection first and only the green no-print button.

Diagnostics are optional. They contain whitelisted source address/postal/quantity/fare and carrier conversion metadata, not credentials or full workbook contents. A destination warning records the status at registration; it does not claim to track later manual corrections in Daesin 마감관리.
