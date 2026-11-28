---
id: 117
title: Price statements from the latest balance check
scope: backend-domain
status: implemented
---

When you open a credit card's statements, the statement balance uses the last eligible balance check in its cycle. The lookup sorts by calendar day and then scans backward. Because the store keeps multiple balance checks per day, a morning balance entered after an evening balance can be picked as the latest.

Keep the exact observation time in the statement lookup and order balance checks by that time before selecting the last eligible one. Keep the existing cycle boundaries and cutoff.

## References

- `docs/TERMS.md:96-107` defines which balance check should determine the statement balance.
- `backend/internal/safespending/derive_statements.go:58-75,122-143` selects a balance and sorts the inputs by day alone.
- `backend/internal/store/storetest/contract.go:1032-1063` covers preservation of multiple balance checks per day.

## Verification

Source inspection confirms the statement lookup discards the time when ordering checks. A read-only probe of the selection rule picked the morning balance of $100 instead of the evening balance of $200 when the evening check was supplied first.

Add a statement test with those checks in both insertion orders and require the $200 balance in both cases. Also verify that a check after the cutoff does not affect the statement and that transfer matching still receives the corrected balance.

Implemented in commit `e9c8aaca`.
