# Safe spending: summarize each payment window once

For `checking` on `2026-10-08`, existing tests expect `Housing` and `Living` commitments of `4200` this month and `3200` next month. Totals, bill groups, and transaction rows each filter the same activity independently, so their membership rules can drift.

Create `mandatorySpendingWindow`, a domain helper that returns a total, groups, and transaction rows for explicit start/end dates. Replace the repeated account/date/requested-amount predicates with that summary. Realized historical spending remains a different calculation from requested commitments.

Pass the summary to the bills panel rather than independently built facts. If its control props change, group `section`, `frame`, and `onFrameChange` as `billWindow`, and the transaction-order value/callback as `transactionSort`.

- Expected totals: `frontend/src/domain/safeSpending.test.ts:227-285`.
- Repeated predicates: `frontend/src/domain/safeSpending.ts:95-103,120-128,319-321,372-374`.
- Independent construction: `frontend/src/pages/outlook/safe-spending/SafeSpendingPreview.tsx:175-192,250-306,417-432`.
- Panel inputs: `frontend/src/pages/outlook/safe-spending/SafeSpendingBillsPanel.tsx:132-154`.

Resolve [selection consistency](safe-spending-bill-selection.md) first or verify it separately. Assert that totals equal grouped requested amounts and rows represent the same occurrences. Cover partial payments, date boundaries, overrides, and calendar/statement-cycle windows. These browser-local settings do not match an existing server-summary contract.
