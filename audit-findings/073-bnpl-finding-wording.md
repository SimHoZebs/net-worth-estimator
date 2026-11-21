---
id: 073
title: Use one finding-state wording for BNPL rows
scope: frontend-domain
status: needs-review
---

Prior finding 045 consolidated finding wording into `findingStateLabel` and is implemented. The BNPL table kept a separate pair. `findingLabel` checks only `confirmed` and `strength`; it has no rejected, dismissed, stale, or judgment branch, while `findingStatus` beside it does branch on those fields. A rejected strong BNPL finding therefore shows "Likely BNPL" in the Finding column and "Not BNPL" in the Status column of one row. The BNPL pair also ignores `judgment`, which the shared owner handles.

Make `findingLabel` and `findingStatus` delegate to `findingStateLabel`, passing a finding with `kind` set to the display string `"BNPL"`. Keep the unanswered strong or moderate output "Likely BNPL" and "Possible BNPL" that the analyses documentation relies on. Decide two intentional wording differences during the change: the shared `label` style gives "Confirmed BNPL" where the badge says "BNPL", and the shared `status` style gives "Needs review" where the column says "Active".

Verify that a rejected strong finding renders "Not BNPL" in both columns. Existing confirmed, likely, and possible cases in `analysisFindings.test.ts` and all of `paymentFindings.test.ts` must pass unchanged, and 045's list-chip and dialog parity must remain intact.

References: `frontend/src/domain/analysisFindings.ts:18-31`; `frontend/src/domain/paymentFindings.ts:58-112`; `frontend/src/pages/sources/AnalysisFindings.tsx:121-139`; `audit-findings/045-finding-state-wording.md:8-14`.
