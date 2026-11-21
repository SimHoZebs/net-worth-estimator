---
id: 114
title: Remove hints that restate the control
scope: ui-ux
status: needs-review
---

Several persistent sentences charge attention on every viewing while saying what the control already says. The scan-window paragraph repeats its label and the input's minimum and maximum. The sign-up hint duplicates native `minlength` validation. Two read-only notices restate disabled fields and a disabled Save button without offering recourse. The configuration note lists its own field labels and the Save action. The UI principles already discourage this pattern.

Delete the scan-window sentence, the character-count hint, both read-only restatements, and the configuration field list. Keep native validation and the lock indicator as the state cues.

Verify that the bounded inputs still validate and read-only still blocks edits and save. No test asserts these strings.

References: `frontend/src/pages/sources/GmailProviderPanel.tsx:340`; `auth/better-auth/src/pages.ts:53`; `frontend/src/pages/evaluations/IndependenceConfigure.tsx:368`; `frontend/src/pages/purchase-planner/PlannedPurchaseEditor.tsx:125`; `frontend/src/pages/evaluations/FinancialIndependenceModal.tsx:89`; `docs/UI_UX_PRINCIPLES.md`.
