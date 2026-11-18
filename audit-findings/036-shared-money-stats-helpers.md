---
id: 036
title: Collapse money formatting and stats helpers
scope: backend-domain
status: accepted
---

`formatCents` and the tail of `parsePatternAmount` repeat the same round-and-format spelling (`pattern_to_new_rule.go:77-79` vs `pattern_to_existing_rule.go:69-81`). The existing-rule path adds a Facts-then-expression fallback (`amountOf` at `pattern_to_existing_rule.go:209-225`) with no counterpart in the new-rule builder, so two amount policies exist for one dollar value. Separately, `paymentMedian` aliases `recurringMedian` while `paymentMean`/`paymentStd` exist only to feed one `paymentCV` call in `summarizePayments` (`payment_patterns.go:94-122`, sole consumer `payment_observations.go:148-151`).

Reuse one cents formatter with one documented fallback policy, and collapse the CV chain to a single coefficient helper calling `recurringMedian` directly.

Verify with `go test ./internal/analysis/ -run 'TestBuildPatternToNewSchedule|TestBuildPatternToExistingSchedule|TestRentUsesSharedStreams|TestHundredsOfClassifications' -count=1`; include zero-amount and missing-facts cases.

References: `backend/internal/analysis/pattern_to_new_rule.go:77-79,134-141`; `backend/internal/analysis/pattern_to_existing_rule.go:69-81,209-225`; `backend/internal/analysis/payment_patterns.go:94-122`; `backend/internal/analysis/recurring.go:24-32`.
