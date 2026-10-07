# Daesin integration 0.5.0

Local entry: `http://127.0.0.1:4320/?daesinSync=1`. Install/upgrade instructions and ZIP are served at `/registration-test-setup/index.html`. Upgrade the existing extension in place; do not uninstall it. The extension remains restricted to the localhost app and the Daesin partner origin. This version has not been deployed to the production website. Logen behavior is unchanged.

## User flow

- **대신 전산 연동** accepts selected Daesin shipments or every Daesin shipment in the current filtered list. The selected set is captured when clicked. An initial carrier lookup reconciles previous/manual registrations, then new shipments are submitted sequentially using the proven single-row native registration flow. Data is refreshed again for every target date afterward.
- **전산 데이터 새로고침** only queries the selected date, downloads the original export, persists that date's Daesin dataset and runs existing verification. It never registers or prints. Carrier-side quantity/fare/destination corrections become visible without re-registration.
- An empty daily response preserves previously saved data. Invalid, duplicated or foreign waybill IDs, incomplete exports and unavailable carrier responses also preserve it.
- Prohibited service is a definite failure. Explicit retry requires an edited exported payload and the retry checkbox. Pending/unknown submissions are held for reconciliation. Missing or ambiguous results are never blindly replayed.
- Shared/unassigned destinations can register. The native no-print button is used only after selecting the exact row and checking recipient, quantity, fare and receipt date. The UI retains destination correction warnings; missing-destination records omitted by the carrier export are reported separately.
- The existing manual Excel import and download remain available as fallbacks.

## Durable identity and concurrency

`shipments.daesin_registration` stores attempt identity, source snapshot, state and the full 12–13 digit carrier number. `daesin_registration_update` is a security-invoker RPC using the existing company-shared shipment RLS. A row lock atomically claims a shipment after checking its current input snapshot. Another tab/PC cannot claim that pending or accepted shipment. An old attempt cannot replace a newer one or downgrade accepted state. A unique index prevents one waybill from binding to multiple shipments.

Ordinary shipment edits do not write this column. Bound waybills take precedence over mutable name/quantity/fare scoring, so edits produce verification differences without losing the association. If the latest export has no corresponding row, the known number remains visible with a warning rather than being reassigned. Initial association requires a unique receiver and phone plus quantity, fare, payment and transport match; ambiguous candidates are held for review.

Extension jobs remain a local audit journal. The app imports their latest attempt into shared state, allowing recovery after closing a tab. A crash after claiming but before sending can leave an uncertain record; it is deliberately not released by a timer because the external submission may have succeeded. Resolve through carrier lookup before any manual replacement.

Migration `20261007055028_daesin_registration_state.sql` was applied and verified on the connected project. It adds only a column, index and invoker RPC; existing shipment records and RLS policies are retained. Anonymous RPC execution is denied. Security advisors report no findings for this new function (pre-existing unrelated search-path/auth settings remain unchanged).

## Verification and remaining live check

- `node --test tests/*.test.cjs`: 55 passing tests, including existing Logen regressions, eligibility/ambiguity rules, durable invoice matching and full 13-digit numbers.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- PostgreSQL execution in an isolated PGlite database: auth/RLS, competing claims, stale snapshots/callbacks, unknown-result protection, corrected retries, immutable/unique numbers and exclusion of Logen passed.
- Actual Next UI + unpacked MV3 extension + mocked native carrier + original XLS parser + isolated PostgreSQL RPC passed: selected-only, filtered-all, pre-existing manual registration, prohibited/shared destinations, unknown-result exclusion, second-click duplicate prevention, source-edit discrepancies, manual carrier correction and refresh, explicit retry, export failure preservation, historical empty refresh, and downloadable reports. Zero live external requests and zero print clicks.
- Separate MV3 native registration fixture passed ten normal/failure scenarios, preserving row checkbox handlers and avoiding the blue print button.
- The user previously confirmed 0.4.2 live registration/data/verification for five shipments. The new 0.5.0 batch/date orchestration has isolated end-to-end evidence; live acceptance of that new flow still needs the user's normal test after updating the extension. Do not represent it as already live-verified or production-deployed.
