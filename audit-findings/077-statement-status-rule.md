---
id: 077
title: Derive statement status in one place
scope: frontend-domain
status: accepted
---

The backend statement read has no status field, so status is correctly derived on the client. It is derived twice. `derivedStatementStatus` maps remaining and allocated amounts to paid-in-full, partially-paid, or open with an `"unknown"` guard for missing amounts. `statementStatusFromTotals` repeats the same ladder for the payment suggestion path. The two already differ in null handling, and a future rule change would need two edits and two test updates.

Extract one helper that takes `remaining` and `allocated` and returns the three concrete statuses. Have `derivedStatementStatus` add only the null-to-`"unknown"` guard around it and have `statementStatusFromTotals` call the helper directly. Keep both exported entry points so callers and tests stay stable.

Verify that both status test sets pass unchanged, including the `"unknown"` cases. Confirm the statement list shows the right status for a known balance with `remaining = 0` and the suggestion queue keeps its open, partial, and paid labels.

References: `frontend/src/domain/derivedStatement.ts:27-42`; `frontend/src/domain/statementPaymentAdapter.ts:55-62,93`; `frontend/src/domain/statementPayment.ts:11-20`; `backend/internal/types/card_statement.go:116-125`.
