---
id: 047
title: Use one pattern summary owner
scope: frontend-domain
status: accepted
---

`reviewTitle` (`patternReview.ts:98-126`) repeats the most-common-name loop in `patternTitle` (`recurringPatterns.ts:68-91`) line for line, differing only in scan scope. `reviewCadenceLabel`, `reviewRecordedCount`, and `reviewAmount` (`:128-155`) only recombine already-grouped row data and are always called as a unit (list at `PatternReview.tsx:486-497`, dialog at `:331-343`), while `TransactionInsights.tsx:182` builds the same sentence inline. The row and dialog blocks duplicate the same cadence/count/amount markup plus the inflow ternary twice (`:336-339` vs `:491-495`). `cadenceLabel` (`:93-108`) and `frequencyLabel` (`:121-139`) repeat the same weekly/monthly mapping.

Extract one shared name helper, replace the trio with one row-summary helper used by both list and dialog, and fold `cadenceLabel` into `frequencyLabel`.

Verify `patternReview.test.ts:135-154` and `recurringPatterns.test.ts:80-100` pass, and list plus dialog headers match.

References: `frontend/src/domain/patternReview.ts:98-155`; `frontend/src/domain/recurringPatterns.ts:68-139`; `frontend/src/components/analysis/PatternReview.tsx:329-344,485-499`.
