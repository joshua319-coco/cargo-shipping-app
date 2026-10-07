# Daesin no-print registration test (0.3.1)

Run the existing Next app at `http://127.0.0.1:4320/?registrationTest=1&shipmentDate=2026-10-06`. This local-only development UI shares the authenticated production shipment data, but the helper does not write shipment/waybill records back to the database. It is not deployed to production.

Only a newly requested, single Daesin shipment dated 2026-10-06 with a recipient matching `대신자동업로드테스트` plus a positive integer may run. Existing helper jobs are never automatically replayed after upgrade. Upgrade in place and reload the same extension ID to preserve local history.

## Flow

1. Generate the normal production Excel workbook in memory (half-box rounds up, fare retained).
2. Wait for Daesin's saved upload settings, then trigger its native file-change handler in a fresh tab.
3. Classify the single upload response and current destination fields. Normal agency codes proceed. Shared jurisdiction or unassigned destinations also proceed, recording a post-registration correction requirement. Explicit parcel/freight-unavailable conditions are reported as not registered. Unknown data is held for review.
4. Verify one rendered row matches the requested recipient, quantity and fare. Click that row's `checkN` checkbox, allowing the native handler to update hidden selection fields; verify it stayed checked.
5. Find exactly one visible, enabled button labelled `등록(출력안함)` and click it once. Never substitute the blue `등록` button, guess print-mode parameters, or change the branch/printer configuration. A submission marker prevents collision with a manual submit during the selection step.
6. Observe the known `insertFixUnsongApply` response. The observed single-row result SUCCESS is displayed as registered even when resultBillNos has no readable number. A number is never fabricated. Existing 0.3.0 SUCCESS jobs migrate to registered-awaiting-number. Warnings remain attached to that job and counted separately. Read-only recovery from dailySearch requires the selected date plus exactly one matching recipient, quantity, fare, transport type and registration date. Phone and payment are also checked when stored. Multiple matching names/numbers are rejected; known numbers require an exact recipient cell, not a substring.
7. A missing/ambiguous response stays unknown and is not retried. A persistent deadline is evaluated on status reads, so a suspended service worker cannot leave a job pending indefinitely when the user reopens the UI.

The original read-only diagnosis redacted numeric branch constants, so this helper deliberately uses the observed native no-print button instead of calling `applyUnsong` with a guessed argument. It does not automatically dismiss arbitrary carrier dialogs. Unexpected validation or confirmation UI is left visible and reported as a result needing review.

## Verification

- Business-rule tests cover assigned destinations with a blank warning counter, shared jurisdiction, unassigned destinations, prohibited service and unknown/multiple rows.
- Isolated MV3 browser tests intercept all carrier traffic. Normal/shared/unassigned cases run the native row-selection handler and only the no-print button. Prohibited service, missing no-print button, failed selection, wrong recipient, rejected response and connection failure are separately asserted. The blue button is never clicked, print count remains unchanged, and duplicate requests do not submit again.
- TypeScript and existing carrier/address regression tests pass. These fixtures establish implementation behavior, not live carrier acceptance of the new automatic-click step.
- Before 0.3.0, the user confirmed the in-memory upload works against Daesin and explained that joint jurisdiction/unassigned routes remain registerable, with manual destination corrections in 마감관리 after registration. The user explicitly requires row selection first and only the green no-print button.

Diagnostics are optional. They contain whitelisted source address/postal/quantity/fare and carrier conversion metadata, not credentials or full workbook contents. A destination warning records the status at registration; it does not claim to track later manual corrections in Daesin 마감관리.

## Live acceptance evidence and remaining scope

The user confirmed tests 4, 5 and 6 were actually registered via 0.3.0. Their 0.3.0 report records SUCCESS for all three; test 6 retains the joint-jurisdiction warning. The displayed 0 completed count was a state-model bug: success was incorrectly dependent on extracting a waybill. No-print response contents beyond the preserved result/message were not retained, so the absence/format of resultBillNos is not yet established.

Version 0.3.1 separates accepted registration from waybill availability and preserves existing jobs. It provides an optional dailySearch structural diagnostic in the report (control labels, field names, table headers and native export-handler definitions; no row data, cookies or storage). It never runs those export handlers. Actual lookup against the live dailySearch DOM still requires user verification; isolated browser tests use the observed table labels.

The established production workflow is dailySearch selection dropdown → 전체 → 엑셀저장 → existing Daesin upload parser. It includes sender/receiver details, payment, fare, service, parcel address and freight agency for cross-verification. Production automation must feed that full dataset into the existing verification pipeline, and offer selected/all unregistered shipments in batches. Number-only test recovery does not replace that pipeline. Full dataset transfer, batch registration and production database writeback remain pending; do not deploy this local helper as the completed production flow.


## 0.4.0: full workbook import (local test)

Supersedes the DOM number-only recovery above. The user supplied dailySearch HTML on 2026-10-06. Its public search_ctrl.js exposes selectArticleList and selectLabelPrintList with downloadFlg=Y, then downloadFile using resultList.filePath. The helper issues only those observed read/export requests in the authenticated tab, with a fresh daily query, no route filter, and at most 1000 waybill IDs. The Y flag is hard-coded; it never invokes the shared print callback. No download permission or local file access is added.

The workbook bytes are passed in memory through the local bridge into the existing handleWaybillUpload parser and shared verification save path. This user-triggered operation now persists the same two shared verification fields as manual Daesin upload; extension status alone does not claim that this save succeeded. Full sender and parcel address columns are required. Foreign/duplicate numbers, missing assigned rows, empty data and invalid dates preserve the existing dataset. Missing unassigned rows are named separately, with the registered status and independently confirmed waybill preserved. Refreshing the data also updates destination warnings after manual corrections.

Lookup and registration remain distinct: exact unique structured recipient/phone/quantity/fare/service/payment evidence connects a job number; the complete Excel goes through existing cross-verification, including mismatches. The native receiver cell embeds a tooltip address, which made string-only matching unreliable. The old per-row number-only UI is removed. Existing jobs and extension storage keys remain unchanged. Production deployment and batch registration are still pending.


## 0.4.1: 날짜 경계와 조회 실패 진단

자동 가져오기는 조회한 2026-10-06 세션에만 저장한다. 오늘 세션의 로젠·대신·PDA 데이터를 덮지 않으며 로컬 테스트의 송장검증도 같은 날짜로 조회한다. 실패한 목록 조회의 빈 번호/형식/중복 건수 및 최대 10개 문제 행을 최근 5회까지 저장하고 확인결과 보고서에 포함한다. 조회 오류의 실제 원인은 이 진단으로 확인해야 하며 중복 행을 임의로 버리지 않는다. 송장번호는 공백/하이픈 제거 후 같은 값을 엑셀 요청과 대조에 일관되게 사용한다.

검증: 단위 회귀 44건 및 TypeScript 검사 통과. 격리된 Edge의 실제 MV3 확장과 로컬 앱을 연결하고 대신/Supabase 통신을 전부 모의 처리하여 10월 7일에 6일 데이터 저장, 당일 상태 보존, 과거 송장검증, 실패 이력 보고서 포함을 확인했다. 실제 대신 조회 오류의 원인은 아직 수집 전이며 운영 배포하지 않았다.


## 0.4.2: 확인결과 저장이 대신 탭을 기다리지 않도록 분리

보고서 요청은 chrome.storage.local에 이미 저장된 접수 이력과 최근 조회 오류를 한 번에 읽는다. 대신 탭 검사와 상태 변경 대기열을 거치지 않으며 진행 중 작업 이름/시각만 함께 기록한다. 기존 0.4.1 오류 기록을 그대로 읽는다. 화면에는 준비 중, 다운로드 요청 안내, 수동 다운로드 링크 및 복사용 내용을 표시하며, 응답 지연을 확장 미설치라고 단정하지 않는다. 사용자가 제공한 0.4.1 보고서에서 전체 32행이 정상적인 13자리 번호로 확인되었다. 12자리로 잘못 고정했던 접수 응답 추출·번호 수신·조회·엑셀 대조 검사를 모두 12~13자리로 수정하고 번호 전체를 그대로 유지한다. 기존 허용 12자리와 구분자 정규화는 보존하며 다른 길이·중복·외부 번호는 계속 거절한다.

검증: 회귀 49건 및 TypeScript 통과. 실제 MV3 확장과 로컬 앱을 사용한 격리 테스트에서 13자리 조회 → 엑셀 원본 → 6일 저장 → 송장 연결/주소 대조, 확인결과 자동/직접 다운로드 및 내용 표시를 확인했다. 모의 출력안함 접수 10개 시나리오도 통과했다. 대신과 DB 요청은 모두 모의 처리했으며 실제 접수·인쇄·운영 배포는 실행하지 않았다.
