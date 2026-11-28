---
id: 134
title: Restrict the saved range to saved-model requests
scope: backend-api-persist
status: implemented
---

A saved range represents the saved model. The deterministic projection checks that the request uses the saved model without overrides before consulting stored results. The range endpoint lacks that check, so it can use saved results for computations with different inputs.

Reuse the deterministic projection's eligibility check for saved range reads and writes. Keep other requests on the existing computation path that receives their supplied inputs.

## References

- `docs/unified-projection.md:82` defines when to compute directly.
- `backend/internal/api/projections/deterministic.go:68-89` enforces eligibility.
- `backend/internal/api/projections/stochastic.go:142-195` selects the range computation path.

## Verification

Source comparison confirms the handlers apply different eligibility checks.

Add a unit test for the shared eligibility rule and assert that the saved range store is used only for eligible inputs. Confirm ordinary saved-model requests retain their existing path.

Implemented in commit `5439ddc0`.
