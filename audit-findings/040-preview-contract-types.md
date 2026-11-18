---
id: 040
title: Tighten the preview contract to one header and one evidence shape
scope: contracts-types
status: accepted
---

Both previews describe the same confirmed pattern with copied headers (`FindingID`, `PatternKey`, `Merchant`, `Cadence`, `AccountID`, gate plus `Reason`, evidence list) differing only in the action tail. `PatternToNewSchedulePreview` (`analysis_pattern_to_new_rule.go:38-53`) and `PatternToExistingSchedulePreview` (`analysis_pattern_to_existing_rule.go:6-17`) duplicate six header fields; `PatternOccurrence` vs `UpcomingNewScheduleOccurrence` duplicate `{date, amount}`; `ProposedNewSchedule` duplicates seven `Schedule` fields (`model.go:271-283`) forcing a lossy handler remap (`pattern_to_new_rule.go:93-102`); and `Reason` is required on one preview but `omitempty` on the other while the client widens lists to null.

Embed one shared header plus one `DatedAmount` evidence shape, define the proposal as a constrained view of `Schedule` with one expression-amount converter at the store boundary, make `reason` present only when the gate is closed, and emit `[]` never null.

Verify OpenAPI snapshot regenerates identically, both dialogs render the same gate messages, and promotion round-trip tests pass.

References: `backend/internal/types/analysis_pattern_to_new_rule.go:8-53`; `backend/internal/types/analysis_pattern_to_existing_rule.go:6-17`; `frontend/src/api/generated/model/patternToNewSchedulePreview.ts`; `frontend/src/components/analysis/RecurringPatterns.tsx:91-160,309-322`.
