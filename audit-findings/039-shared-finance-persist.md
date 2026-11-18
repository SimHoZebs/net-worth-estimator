---
id: 039
title: Persist both forecast actions through one finance helper
scope: backend-api-persist
status: accepted
---

The create path delegates validation, revision, and last-write-wins to `model.PersistFinanceSchedule` (`pattern_to_new_rule.go:107-109` over `model/writes.go:68-144`), while the link-to-existing path hand-rolls baseline, claims, `ValidateFinanceWriteChange`, `SetPatternTransactionClaims`, reload, `ValidateFinanceModel`, and `ModelETag` inline (`pattern_to_existing_rule.go:106-168`). Two persist owners exist for one acceptance contract.

Make the link path build its claim mutation through the same `runFinanceRowWrite` helper with `SetPatternTransactionClaims` as the persist step. Keep the enabled-rule recheck and empty-assignment guard as path-specific checks.

Verify existing-rule claim counts, idempotent re-add, unknown/disabled-rule 422, and payment link contracts stay green.

References: `backend/internal/api/analyses/pattern_to_new_rule.go:107-109`; `backend/internal/api/model/writes.go:68-144`; `backend/internal/api/analyses/pattern_to_existing_rule.go:101-168`.
