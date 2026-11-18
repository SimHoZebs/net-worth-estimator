---
id: 037
title: Share one store preview loader
scope: backend-api-persist
status: accepted
---

`PreviewPatternToNewSchedule` and `PreviewPatternToExistingSchedule` run the same read path: identical anchor load (`analysis_pattern_to_new_rule.go:24-41` vs `analysis_pattern_to_existing_rule.go:21-39`), identical occurrence collection plus facts-map fan-out (`:45-95` vs `:43-101`, second copy adds only a de-dupe pass), diverging only at the final builder (`BuildPatternToNewSchedulePreview` vs `BuildPatternToExistingSchedule`).

Extract one shared loader for anchor finding, occurrence IDs, facts map, and model. Keep only the per-variant tail: promotion lookup plus new-schedule preview vs rule lookup plus existing-schedule preview with claimable reasons.

Verify with sqlite preview tests including not-found, stale-conflict, and missing-rule branches.

References: `backend/internal/store/adapters/sqlite/analysis_pattern_to_new_rule.go:24-108`; `backend/internal/store/adapters/sqlite/analysis_pattern_to_existing_rule.go:21-123`.
