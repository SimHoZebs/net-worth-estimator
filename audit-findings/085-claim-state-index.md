---
id: 085
title: Build one claim-state index in the Safe Spending replay
scope: backend-domain
status: needs-review
---

## Scenario

When you open the Safe Spending screen, the browser sends `GET /v1/safe-spending-summary?asOf=...` to the API. The `asOf` query value is the evidence cut, a fixed instant such as the close of a day at which the replay stops; the request carries no body beyond that cut. The API reads your stored transactions and schedules from the app's local financial model and replays them to the cut before the screen shows any amount. The response crosses the boundary as JSON carrying how much more you can spend, which bills still need cover, and what the card statements will hold. The replay itself runs in `BuildAtCut` in `backend/internal/safespending/summary.go`.

Central to the Safe Spending replay is a claim, the link in `transaction_claims` between a bank transaction and one expected occurrence of a recurring payment such as a single rent payment. A claim decides whether that occurrence is already paid. A transaction row is posted when the payment actually settled, or pending when only an authorization was seen. When two rows claim the same occurrence, the posted row wins over the pending one. Claim indexes exist because a replay must know which expected payments are already covered by evidence before it can forecast what cash is still needed.

`buildObligations` in `backend/internal/safespending/obligations.go:132-158` builds a claim-to-transaction map with the posted-beats-pending preference to work out bills. `claimState` in `backend/internal/safespending/payday_income.go:11-35` builds separate settled and pending sets from the same transactions at the same cut, and `forecastPaydays` in `payday_income.go:69` and `cardStatementRows` in `backend/internal/safespending/payday_statements.go:286,324-327` read those sets for the payday forecast and card statement rows. Both classifications start from the same `TransactionClaim` identities, the pair of schedule ID and occurrence date, over the same transactions at the same cut. Because the inputs are equal, the posted-beats-pending rule can drift between the bills view and the payday and statement views with no single place to fix it.

## Executive summary

The claim and link mechanisms are sound and still needed: auto-claim writes the ordinary claim row in `backend/internal/domain/auto_claim.go`, bank-row dedup uses provider keys, and canonical-payment IDs prevent one posted payment backing two allocations. The duplication is narrower. A claim associates a transaction with an expected payment occurrence, and "at a cut" means at one replay boundary. `buildObligations` builds a claim-to-transaction map with a posted-beats-pending preference, while `claimState` builds separate settled and pending sets over the same transactions at the same cut. Both classify the same claim identities, so their precedence can drift.

The recommended action is to compute one claim-state index and pass it to all three consumers instead of rebuilding the classification in each.

## Recommended action

Compute one claim-state index at the start of `BuildAtCut`, keep the posted-beats-pending rule in it, and pass it to `buildObligations`, `forecastPaydays`, and `cardStatementRows`. Leave the claim, reconcile, and canonical-payment paths untouched.

## Before and after

| Before | After |
| --- | --- |
| Two indexes over the same transactions at the same cut: an obligations map with posted-beats-pending, and separate settled/pending sets in `claimState`. | One shared claim-state index built once and consumed by obligations, payday forecast, and card statement rows. |

```mermaid
flowchart LR
  subgraph Before
    A[transactions] --> B[obligations map]
    A --> D[claimState sets]
  end
  subgraph After
    E[transactions] --> I[one index] --> O[obligations]
    I --> F[forecastPaydays]
    I --> C[cardStatementRows]
  end
```

## Expected improvement

Structural. A single classification keeps the posted-beats-pending rule from drifting between the obligations view and the payday and statement views. No benchmarks were run, so no speed or size improvement is claimed.

## Alternatives considered

- Keep two indexes. Rejected because precedence can drift and the two return different shapes.
- Merge the claim, reconcile, and canonical-payment paths as well. Rejected as out of scope; those paths are sound and this finding targets only the duplicated classification.

## Downside of rejecting

Two indexes over the same data can classify the same claim differently, producing inconsistent obligations versus payday and statement results with no single place to fix the rule.

## Verification

Use a case with a pending and a posted row claiming the same occurrence and assert both consumers classify it identically, then run claim, auto-claim, payday, and pending-statement tests. These are proposed acceptance checks. No disagreement was observed; the risk is drift and the two indexes returning different shapes.

References: `backend/internal/safespending/obligations.go:132-158`; `backend/internal/safespending/payday_income.go:11-35`; `backend/internal/safespending/payday_statements.go:286,324-327`; `backend/internal/domain/auto_claim.go:184-301`.
