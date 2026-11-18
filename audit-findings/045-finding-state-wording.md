---
id: 045
title: Use one finding-state wording
scope: frontend-domain
status: accepted
---

The pattern review list and its dialog use different helpers for the same state machine over `status`, `review.decision`, `dismissed`, `stale`, `judgment`, and `isMainIncome`. `reviewChipLabel` (`patternReview.ts:162-174`), `paymentLabel` plus `paymentStatus` (`paymentFindings.ts:58-79`), and `recurringPatternStatus` (`recurringPatterns.ts:141-148`) branch on the same fields with slightly different strings. `PatternReview.tsx` consumes all three at once (dialog at `:97,161`, list chips at `:501`). Copies already drifted: `reviewChipLabel` drops the strength-based likely/possible branch kept in `paymentLabel`.

Merge into one finding-state helper with a display-style parameter. `reviewChips` delegates to it instead of owning its own chain.

Verify existing `patternReview.test.ts:170-200` and `paymentFindings.test.ts:24-70` cases pass unchanged, and list chips match dialog statuses for withdrawn, rejected, dismissed, stale, and pending judgments.

References: `frontend/src/domain/patternReview.ts:162-192`; `frontend/src/domain/paymentFindings.ts:58-79`; `frontend/src/domain/recurringPatterns.ts:141-148`; `frontend/src/components/analysis/PatternReview.tsx:97,161,501`.
