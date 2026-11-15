---
id: 026
title: Use React state without selection aliases
scope: contracts-types
status: implemented
---

useSelectedId/useSelectedEntry only call useState. They enforce no identity resolution, synchronization, or cleanup; callers own that behavior.

Use typed useState directly and delete the aliases. Keep transactionSelectionKey, which distinguishes recorded IDs from projected transaction/date identity.

**Weight:** small optional trim. It reduces concepts, not runtime work. Check the diff because explicit types/imports can offset line savings.

## References

- `frontend/src/components/entrySelection.ts:13-32` defines aliases; lines 4-11 hold genuine key logic.
- `frontend/src/components/cards/AccountCardGrid.tsx:25` and `frontend/src/components/cards/AccountDetailsModal.tsx:91` consume useSelectedId.
- `frontend/src/components/funding/FundingGapsCard.tsx:83` and `frontend/src/components/evidence/ConstraintSnapshot.tsx:34` also consume it.
- `frontend/src/pages/evaluations/FinancialIndependenceCard.tsx:86` consumes useSelectedEntry.

## Verification

Implementation verified by import searches and local cleanup checks recorded in README.

Run typecheck and check selection, dismissal, deletion of selected records, and scope remounts. Preserve key calculation and current-record resolution.
