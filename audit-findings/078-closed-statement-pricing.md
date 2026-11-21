---
id: 078
title: Price a closed statement with one engine
scope: backend-domain
status: needs-review
---

Statements are no longer stored rows; `DeriveStatements` and the Safe Spending summary each price them from recorded evidence. For a closed cycle `DeriveStatements` takes the bank balance observed inside the cycle and negates it, while `buildStatements` opens a checkpoint replay at the first close and carries posted charges and payments forward. They feed different surfaces — the card-statements API and transfer-pair analysis use the first, the Safe Spending summary the second — and nothing declares one authoritative. The `DerivedStatement` doc describes the replay rule that the function does not use for closed cycles.

Choose one close-pricing rule and make both surfaces consume it: have `buildStatements` call `DeriveStatements` or extract the shared close-pricing routine. Keep `cardStatementRows` as the single replay engine for estimated cycles and keep the `card_statements` drop-and-rekey migration body until every target verifies. This is deletion of one derivation path, not extension of a framework.

Verify with a differential test asserting closed balances from both paths match across a fixture with a checkpoint at every close, one with gaps, and one with intra-cycle payments, then run the existing derive-statements, payday, and evidence tests. No divergent value was observed in a run and production checkpoint density is unknown, so treat this as a drift risk rather than a proven wrong balance.

References: `backend/internal/safespending/derive_statements.go:11-18,52-85`; `backend/internal/safespending/payday_statements.go:78-127,264-272`; `backend/internal/types/card_statement.go:5-18`; `backend/internal/api/model/safe_spending_summary.go:45`; `backend/internal/api/analyses/transfer_pair.go:112`.
