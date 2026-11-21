---
id: 070
title: Stabilize the statement suggestion passed to the insights memo
scope: frontend-state
status: accepted
---

`TransactionDetail` memoizes `insightSuggestions` so `buildInsightSuggestions` does not walk analysis findings on every editor keystroke. The memo lists `statementSuggestion` as a dependency, but that value is recreated in the render body of `useStatementPaymentReview`: the matcher builds a new `suggestion` object and then spreads it again to attach `accountName`. When a statement-payment match exists for the open transaction, the dependency has a new identity on every render, so the memo recomputes in exactly the case it was written to protect. The other dependencies are stable. This is structural render cost, not a profiled re-render, and the work is bounded because the findings query is scoped to one transaction.

Memoize the `suggestion` derivation inside `useStatementPaymentReview` on its inputs — `query.data`, `selection`, `readOnly`, `transactionId`, and `accounts` — so the returned reference is stable when nothing changed. Keep the `statementSuggestion` dependency in `TransactionDetail`, because a genuine statement change must still invalidate insights.

Verify with a rerender test holding those inputs fixed: the `suggestion` reference and the `insightSuggestions` array identity must stay unchanged while a match is active. Choosing another statement, toggling read-only, changing the resolved account name, or a refetch that changes matches must still produce a new suggestion and updated insights.

References: `frontend/src/components/activity/TransactionDetail.tsx:801-807,808-826,824`; `frontend/src/components/activity/useStatementPaymentReview.ts:29-74,77-82`.
