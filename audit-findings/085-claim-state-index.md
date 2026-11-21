---
id: 085
title: Build one claim-state index in the Safe Spending replay
scope: backend-domain
status: needs-review
---

The claim and link mechanisms are sound and still needed: auto-claim writes the ordinary claim row, bank-row dedup uses provider keys, and canonical-payment IDs prevent one posted payment backing two allocations. The duplication is narrower. `buildObligations` builds a claim-to-transaction map with a posted-beats-pending preference while `claimState` builds separate settled and pending sets over the same transactions at the same cut. Both classify the same claim identities and can drift on precedence.

Compute one claim-state index at the start of `BuildAtCut`, keep the posted-beats-pending rule in it, and pass it to `buildObligations`, `forecastPaydays`, and `cardStatementRows`. Leave the claim, reconcile, and canonical-payment paths untouched.

Verify with a case containing a pending and a posted row claiming the same occurrence and assert both consumers classify it identically, then run claim, auto-claim, payday, and pending-statement tests. No disagreement was observed; the risk is drift and the two indexes return different shapes.

References: `backend/internal/safespending/obligations.go:132-158`; `backend/internal/safespending/payday_income.go:11-35`; `backend/internal/safespending/payday_statements.go:286,324-327`; `backend/internal/domain/auto_claim.go:184-301`.
