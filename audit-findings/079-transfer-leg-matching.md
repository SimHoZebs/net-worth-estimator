---
id: 079
title: Match transfer legs with one shared rule
scope: backend-domain
status: accepted
---

## Scenario

A transfer between two of your own accounts arrives from the bank as two separate records: an outflow from one account and an inflow into the other. The two sides are logged separately, so they can post days apart. Backend analysis pairs the records as one transfer so the money is not counted twice, and excludes transfer legs from payment evidence. This work runs inside the backend analysis and store layers when the browser requests an analysis or payment findings; the three actors are the transfer detector in `backend/internal/analysis/transfer.go`, the payment-stream exclusion path in `backend/internal/analysis/payment_transfers.go`, and the link validator in `backend/internal/store/adapters/sqlite/transfer_links.go` that runs when an owner confirms a pair. The facts crossing those internal boundaries are bank transaction facts — an amount string, a currency, and a posting timestamp — carried as JSON, a text format for structured data.

A leg is one side of the transfer. The matching predicate — a yes/no rule — treats two legs as a pair only when both are settled, meaning posted and final rather than pending or void; both are in USD; the amounts have opposite signs; the accounts differ; the amounts are equal to the cent; and the posting gap is at most seven days. The seven-day window is the control value here: `transferMatchWindowDays` is set to 7 in each of the three files because the two sides of one movement are logged apart, and product decision VIS-03 fixed the value. Each file carries a comment saying its copy mirrors another, so the window changes only when someone edits all three. Two legs count as the same pair only when all six of those fact values line up.

A second rule, the nettable-link predicate, nets a confirmed external outflow against an external inflow of equal rounded amounts so a row total counts the pair once instead of twice. An external leg is money moving across the boundary of the tracked account set rather than between two tracked accounts. That predicate lives in `backend/internal/domain/path.go` and `backend/internal/domain/flowgraph.go`, and the link validator checks it before writing a link. The detector's scoring of candidate pairs and the netters' side effects stay local to each path.

```mermaid
flowchart LR
  A[You request an analysis or payment findings] --> B[Backend reads bank transaction facts as JSON: amount string, currency, posting timestamp]
  B --> C[transfer.go detector pairs settled USD legs with opposite signs, different accounts, equal cents, and a gap of at most transferMatchWindowDays = 7]
  C --> D[payment_transfers.go excludes the paired legs from payment evidence]
  C --> E[When an owner confirms a pair, transfer_links.go validates with its own copy of the 7-day window]
  D --> F[Analysis counts the transfer once instead of twice]
  E --> G[The confirmed link is written]
```

## Executive summary

The rule for matching opposite transfer legs — settled, USD, opposite sign, different accounts, equal cents, within seven days — is implemented in three places: the transfer detector, the payment-stream exclusion path, and the SQLite link validator, which carries its own copy of the seven-day constant with a comment that it mirrors the detector. A second rule, the nettable-link predicate of an external outflow plus an external inflow with equal rounded amounts, is implemented again in both the path netter and the flow-graph netter.

The cost is that a window or sign-rule change needs coordinated edits, and a missed one silently changes which payment evidence is excluded and which pairs net. The single action is to give each predicate one shared home in `domain` and keep the side effects local.

## Recommended action

Move the facts-level leg predicate and window constant into one domain helper called by the detector, `paymentTransferPairs` or `paymentLegKeyFacts`, and `invalidTransferPair`. Extract a separate shared nettable-link predicate used by both netters and by link validation. Keep scoring and netting side effects local and preserve the flow-graph netter's extra guard that the leg appears on no other edge. Keep the link table, membership uniqueness, and approval claims: they fix a real double count and are not duplicated by generic bank-row dedup.

## Before and after

Before: the leg rule lives in three places with three copies of the seven-day constant, and the nettable-link predicate lives in two netters.

After: one leg predicate and constant in `domain` are called by all three sites, and one nettable-link predicate is shared by both netters and link validation. Scoring, netting, and the flow-graph netter's extra edge guard stay local.

```mermaid
flowchart LR
  Before["3 leg-rule copies, 2 nettable-link copies"] -->|extract to domain| After["1 leg rule, 1 nettable rule, side effects local"]
```

## Expected improvement

Structural: one place to change the window or sign rule, after which all paths agree by construction. This is deduplication, not a performance fix, and no measured change in behavior or speed is claimed; no benchmarks were run.

## Alternatives considered

Leave as is: each copy can drift, and the comment that the validator's constant mirrors the detector is a manual promise; rejected. Share only the seven-day constant: leaves the sign, account, and cents rule duplicated, which is the larger part of the predicate. Merge leg matching and nettable linking into one helper: rejected because they are different rules and the flow-graph netter has an extra guard, so the finding keeps them separate.

## Downside of rejecting

A change to the seven-day window or sign rule must be made in three files. Missing one silently changes which payment evidence gets excluded and which transfers net, so a double count or a dropped pair can reach analysis with no failing test to flag it.

## Verification

Verify with one boundary case — an eight-day gap, exact cents, opposite accounts — asserting all paths agree, then run transfer-detector, payment-incremental, link, and netting tests. The shared helper must live in `domain` to avoid an import cycle; partial-window clipping was not inspected.

References: `backend/internal/analysis/transfer.go:14-22,204-235`; `backend/internal/analysis/payment_transfers.go:11-100`; `backend/internal/store/adapters/sqlite/transfer_links.go:56-59,135-173`; `backend/internal/domain/path.go:161-215`; `backend/internal/domain/flowgraph.go:390-445`.
