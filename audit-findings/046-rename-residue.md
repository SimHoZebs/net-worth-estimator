---
id: 046
title: Delete forecast rename residue
scope: contracts-types
status: implemented
---

The live snapshot exposes only `pattern-to-new-schedule` and `pattern-to-existing-schedule` previews, yet `frontend/src/api/generated/model/` still ships byte-identical `*Rule` twins (`proposedNewRule.ts` vs `proposedNewSchedule.ts`, `upcomingNewRuleOccurrence.ts` vs `upcomingNewScheduleOccurrence.ts`, `patternToNewRulePreview.ts` vs `patternToNewSchedulePreview.ts`, plus preview response twins). Nothing outside `generated/` imports them. The same residue exists in backend file names (`pattern_to_new_rule.go` holds only `previewPatternToNewSchedule`). Hand-written `paymentLabel` (`paymentFindings.ts:58-69`) is likewise dead: zero production imports, only test references.

Delete the six orphaned generated files plus barrel exports and rename backend files to `*_schedule.go`; delete `paymentLabel` or fold its judgment branches into finding-state coverage.

Verify client regeneration emits no `*Rule` models, frontend typecheck passes, and no `paymentLabel` import remains outside tests.

References: `frontend/openapi.snapshot.json`; `frontend/src/api/generated/model/proposedNewRule.ts`; `frontend/src/api/generated/model/patternToNewRulePreview.ts`; `backend/internal/api/analyses/pattern_to_new_rule.go:39`; `frontend/src/domain/paymentFindings.ts:58-69`.

Implemented in commit `91ac5165`.
