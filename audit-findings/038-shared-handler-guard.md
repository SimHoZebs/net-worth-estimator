---
id: 038
title: Share one forecast-schedule handler guard
scope: backend-api-persist
status: accepted
---

Both API handlers wrap the same preview-then-mutate shape: own process mutex with the same comment (`patternToNewRuleMu` at `pattern_to_new_rule.go:20` vs `patternToExistingRuleMu` at `pattern_to_existing_rule.go:19`), structural-copy error mappers (`:22-37` vs `:21-36`), repeated canWrite-plus-lock-plus-recheck (`:72-88` vs `:79-100`), and repeated `Cache-Control: private, no-store` preview envelope (`:39-59` vs `:38-62`).

Merge into one shared guard parameterized by invalid/conflict sentinels, with one mutex policy, one status mapper, and one preview envelope. Keep only genuine differences: schedule-ID check and creatable-vs-claimable rejection branches.

Verify both contract suites keep 404/409/422/403 behavior, especially preview-stays-200-while-writes-403.

References: `backend/internal/api/analyses/pattern_to_new_rule.go:15-109`; `backend/internal/api/analyses/pattern_to_existing_rule.go:15-100`.
