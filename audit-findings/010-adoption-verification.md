---
id: 010
title: Verify adoption instead of preserving old implementation contracts
scope: deploy-build-test
status: superseded
---

Priority: high as the completion gate.

The migration repair history cites native-select test compatibility, and the detail-sheet comment cites keeping background list assertions working as a reason for modeless behavior. The surviving native Progress comment also cites reflected attributes callers assert on. These are examples of implementation tests influencing the new interaction contract. Correctly changing portal/dialog locators is necessary, but green regressions do not prove visual or behavioral adoption.

Make the chosen preset and library interaction contract the acceptance baseline. Add a representative reference surface and targeted browser journeys for selection, modal nesting, discard confirmation, date ranges, notifications, and table scrolling. Update old assertions that inspect obsolete implementation details. Map important deleted test intents to app-level coverage without re-testing the library's entire implementation. Add narrow lint checks against retired imports/recipes and new unexplained primitive overrides.

References: commit `a6b19745` message; `frontend/src/components/activity/TransactionDetail.tsx:1444`; `frontend/src/components/Progress.tsx:12`; `frontend/tests/integration/accountActivity.spec.ts:529`; `frontend/scripts/lint-design-system.ts:7`; `TESTING.md:59`.

Verification: current exact-SHA lint/typecheck/unit/build and browser gates, plus light/dark desktop/mobile visual review and readable interaction captures. Test dialog → select → Escape: the list closes, the dialog stays, and focus returns correctly. This audit ran no app suites or browser reproduction and does not certify runtime correctness.

## Decision

The user chose to drop existing UI-related tests and re-add focused tests as actual regressions are discovered. This supersedes the recommendation to port old UI assertions and proactively add a broad replacement interaction suite. Financial-domain, API, authorization, and user-isolation checks remain distinct from presentation tests. Retain the UI harness for future regression tests, report an empty UI baseline explicitly, and use manual visual/interaction verification during migration rather than claiming deleted tests passed.
