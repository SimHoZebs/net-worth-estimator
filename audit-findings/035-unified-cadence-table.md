---
id: 035
title: Unify the three cadence tables
scope: backend-domain
status: accepted
---

Nominal interval days are restated in three places with silently diverging key sets: detector `paymentCadences` (`payment_patterns.go:63-66`: 7/14/30.4375/91.3125/365.25), `recurringCadenceFrequency` (`pattern_to_new_rule.go:44-57`, no biweekly/daily), and `existingRuleIntervalDays` (`pattern_to_existing_rule.go:27-42`, adds daily). Values agree where they overlap; keys do not.

Unify behind one cadence-to-frequency-plus-days table, deriving the two mappers from it. Keep the product rule that biweekly previews stay visible but not creatable (`pattern_to_new_rule.go:195-200`).

Verify with `go test ./internal/analysis/ -run 'TestBuildPatternToNewSchedulePreviewLeavesBiweekly|TestBuildPatternToExistingScheduleMapsToSchedule' -count=1` plus detector tests; tolerance math (`pattern_to_existing_rule.go:204-207`) unchanged.

References: `backend/internal/analysis/payment_patterns.go:63-66`; `backend/internal/analysis/pattern_to_new_rule.go:44-57`; `backend/internal/analysis/pattern_to_existing_rule.go:27-42`.
