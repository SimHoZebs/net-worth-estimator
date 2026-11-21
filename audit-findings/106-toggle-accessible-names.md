---
id: 106
title: Keep a stable name on pin and reveal toggles
scope: ui-ux
status: needs-review
---

These native buttons change `title` and `aria-label` between "Pin" and "Unpin" or "Hide token" and "Show token" while also setting `aria-pressed`. The announced name then asserts the opposite of the pressed state, so a user cannot tell whether the item is pinned. The repository already uses the correct stable-name pattern in pattern review.

Keep one stable name for both `title` and `aria-label` in every state and let `aria-pressed` carry the state. Drop `title` where `aria-label` already names the control.

Verify with NVDA or VoiceOver that the name stays constant while only pressed or not pressed changes, for both pin buttons and the token reveal button. This is markup reasoning; no screen-reader session was run.

References: `frontend/src/components/funding/FundingGapsCard.tsx:156-168`; `frontend/src/pages/evaluations/EvaluationCard.tsx:78-88`; `frontend/src/pages/evaluations/CycleFulfillmentCard.tsx:73-81`; `frontend/src/pages/evaluations/FinancialIndependenceCard.tsx:133-138`; `frontend/src/pages/sources/SyncConnectForm.tsx:77-91`; correct pattern at `frontend/src/components/analysis/PatternReview.tsx:99-120`.
