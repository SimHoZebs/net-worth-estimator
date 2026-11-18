---
id: 034
title: Share one routing comparator
scope: backend-domain
status: accepted
---

`Transaction` and `Schedule` carry the same routing shape (`SourceAccountID`, `Destinations` per `types/model.go:271-275`). `equalRouting` (`pattern_to_new_rule.go:229-245`) and `existingRuleMatchesTransaction` (`pattern_to_existing_rule.go:83-99`) repeat the same nil check, deref, length, and element comparison, and both coherence loops call them back-to-back (`pattern_to_new_rule.go:152-157`, `pattern_to_existing_rule.go:157-168`).

Merge into one helper taking source plus destination pairs. Both builders delegate to it.

Verify with `go test ./internal/analysis/ -run 'TestBuildPatternToNewSchedulePreviewRejectsSplitEvidence|TestBuildPatternToExistingScheduleRejectsRoutingMismatch' -count=1` from `backend/`.

References: `backend/internal/analysis/pattern_to_new_rule.go:229-245`; `backend/internal/analysis/pattern_to_existing_rule.go:83-99`.
