---
id: 041
title: Remove test-only promotion surface
scope: backend-api-persist
status: accepted
---

`AnalysisStore` (`store/analysis.go:20-30`) advertises full promotion CRUD, but production needs only the internal read: `Preview` calls `Find` internally and `autoClaimSweep` calls `List`. `Record`, `Remove`, and external `Find` have no production callers outside adapter tests, and the interface comment claiming these paths never touch financial rows is contradicted by `CreatePatternSchedule` and `SetPatternTransactionClaims` (`analysis_pattern_actions.go:35-61`).

Unexport or delete the unused surface and correct the comment to state pattern actions atomically persist acceptance with the finance change.

Verify with `go build ./...` plus sqlite promotion and auto-claim tests.

References: `backend/internal/store/analysis.go:5-30`; `backend/internal/store/adapters/sqlite/analysis_pattern_to_new_rule.go:136-177`; `backend/internal/store/adapters/sqlite/analysis_pattern_actions.go:35-61`.
