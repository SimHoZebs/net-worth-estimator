---
id: 077
title: Derive statement status in one place
scope: frontend-domain
status: accepted
---

## Scenario

Two credit-card surfaces show a statement's status. The card statements list shows each derived statement with a label such as Open, Partially paid, Paid in full, or Status unknown. The payment suggestion queue shows proposed matches between a posted card payment and a statement, using the same kind of label. When either screen loads, the browser asks the API for statement reads, and the API replies with each statement's billed amount, the total allocated to it, and the remaining balance as JSON, a text format for exchanging structured data. The statement read deliberately carries no status field, so the frontend domain layer—plain functions that shape server data for display—derives the label in the browser before the text is drawn. A status ladder is the ordered rule that maps those amounts to a label: a zero or negative remaining balance means paid in full, a positive allocation means partially paid, otherwise open. `derivedStatementStatus` applied that ladder for the list with an "unknown" guard when any amount is missing, while `statementStatusFromTotals` repeated the same ladder for the suggestion queue. Both are internal functions with no screen calling them directly; they exist because the backend sends the authoritative amounts and leaves the labeling to the client.

## Executive summary

The backend statement read does not return a status field, so the frontend derives it. It derives it twice: `derivedStatementStatus` maps remaining and allocated amounts to paid-in-full, partially-paid, or open with an `"unknown"` guard for missing amounts, while `statementStatusFromTotals` repeats the same ladder for the payment suggestion path. The two copies already handle nulls differently.

The cost is that any status-rule change needs two edits and two test updates, and the card-statements list and suggestion queue can drift apart. The single action is to extract one helper that returns the three concrete statuses and keep both exported entry points stable.

## Recommended action

Extract one helper that takes `remaining` and `allocated` and returns the three concrete statuses. Have `derivedStatementStatus` add only the null-to-`"unknown"` guard around it and have `statementStatusFromTotals` call the helper directly. Keep both exported entry points so callers and tests stay stable.

## Before and after

Before: two functions each implement the status ladder, and they already differ in null handling.

After: one helper owns the ladder, `derivedStatementStatus` wraps it with the null guard, and `statementStatusFromTotals` calls it directly. Both exported entry points remain.

```mermaid
flowchart LR
  Before["Two copies of the status ladder"] -->|extract| After["One helper with thin wrappers"]
```

## Expected improvement

Structural: one rule to change and one place where null handling is explicit, so the two surfaces can no longer disagree about the ladder. This is a maintainability gain, not a measured improvement in speed or size; no benchmarks were run.

## Alternatives considered

Leave as is: the current code works but keeps two ladders that already differ; rejected because a rule change needs two coordinated edits. Merge the exported entry points into one: would change callers and tests; the finding keeps both exports to avoid that churn. Fix only the null-handling difference: treats the symptom and leaves two copies of the ladder.

## Downside of rejecting

The card-statements list and the payment suggestion queue can show different statuses for the same balance as soon as one copy is edited. A new status rule would require two edits and two test updates, and a missed edit would show a wrong label on one surface.

## Verification

Verify that both status test sets pass unchanged, including the `"unknown"` cases. Confirm the statement list shows the right status for a known balance with `remaining = 0` and the suggestion queue keeps its open, partial, and paid labels.

References: `frontend/src/domain/derivedStatement.ts:27-42`; `frontend/src/domain/statementPaymentAdapter.ts:55-62,93`; `frontend/src/domain/statementPayment.ts:11-20`; `backend/internal/types/card_statement.go:116-125`.
