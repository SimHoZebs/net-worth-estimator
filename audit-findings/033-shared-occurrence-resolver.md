---
id: 033
title: Share one occurrence resolver for both preview builders
scope: backend-domain
status: accepted
---

Both preview builders repeat the same validation spine: schedule-kind gate, active check, empty-evidence check, transaction index build, pending/void rejection as stale, timestamp fallback, chronological sort, and the routing coherence loop. `pattern_to_new_rule.go:99-150` and `pattern_to_existing_rule.go:105-156` run the same steps, with only the carrier struct differing (`recurringOccurrence` vs inline occurrence plus `existingRuleTransactionDay`).

Merge into one `resolvePatternOccurrences` helper returning sorted occurrences with day, stamp, and amount. Both builders keep only their final math: new-schedule upcoming projection vs existing-schedule claim mapping.

Verify with `go test ./internal/analysis/ -count=1` from `backend/`; stale vs incoherent error identity and occurrence ordering must be unchanged.

References: `backend/internal/analysis/pattern_to_new_rule.go:70-75,99-157,229-245`; `backend/internal/analysis/pattern_to_existing_rule.go:57-66,83-99,105-168,204-207,279`.
