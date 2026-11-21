---
id: 079
title: Match transfer legs with one shared rule
scope: backend-domain
status: needs-review
---

The product rule for opposite legs — settled, USD, opposite sign, different accounts, equal cents, within seven days — is implemented in the transfer detector, again in the payment-stream exclusion path, and a third time in the SQLite link validator, which carries its own copy of the seven-day constant with a comment that it mirrors the detector rule. The nettable-link predicate — an external outflow plus an external inflow with equal rounded amounts — is then implemented again in the path netter and the flow-graph netter. Changing the window or sign rule needs coordinated edits, and a missed edit silently changes which payment evidence is excluded and which pairs net.

Move the facts-level leg predicate and window constant into one domain helper called by the detector, `paymentTransferPairs` or `paymentLegKeyFacts`, and `invalidTransferPair`. Extract a separate shared nettable-link predicate used by both netters and by link validation. Keep scoring and netting side effects local and preserve the flow-graph netter's extra guard that the leg appears on no other edge. Keep the link table, membership uniqueness, and approval claims: they fix a real double count and are not duplicated by generic bank-row dedup.

Verify with one boundary case — an eight-day gap, exact cents, opposite accounts — asserting all paths agree, then run transfer-detector, payment-incremental, link, and netting tests. The shared helper must live in `domain` to avoid an import cycle; partial-window clipping was not inspected.

References: `backend/internal/analysis/transfer.go:14-22,204-235`; `backend/internal/analysis/payment_transfers.go:11-100`; `backend/internal/store/adapters/sqlite/transfer_links.go:56-59,135-173`; `backend/internal/domain/path.go:161-215`; `backend/internal/domain/flowgraph.go:390-445`.
