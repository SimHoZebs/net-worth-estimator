---
id: 120
title: Resolve transfer information once per transaction list
scope: frontend-state
status: implemented
---

Account activity already gives each visible transaction its transfer information. The row still subscribes to the full set of saved transactions, accounts and transfer links. It also looks up its transfer link independently to decide whether to show a transfer arrow or a business logo.

Resolve transfer information at the list boundary and pass it to the row, including whether the transfer links have loaded and whether the transaction has a link whose other side could not be resolved. Use the same explicit input for the other views that render this row.

## References

- `frontend/src/components/activity/Transactions.tsx:165-192` supplies saved transactions and resolved names to the rows.
- `frontend/src/components/activity/TransactionRow.tsx:57-87` subscribes and checks link membership per row.
- `frontend/src/components/activity/useTransferPeers.ts:10-29` resolves transfer names at the list boundary.
- `frontend/src/components/activity/ScheduleHistory.tsx:73-96`, `frontend/src/components/evidence/ConstraintSnapshot.tsx:63`, and `frontend/src/pages/outlook/safe-spending/TransactionSectionView.tsx:70` render the row outside account activity.

## Verification

Source inspection confirms that the three subscriptions are created per mounted row. No timing or render counts were measured.

Verify that the activity list owns the transfer-link subscription and rows no longer subscribe to saved data. Check linked names and arrows, a linked transaction with a missing other side, logo visibility before and after loading, and the other views that render a transaction row.

Implemented in commit `e68bbbdc`.
