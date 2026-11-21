---
id: 081
title: Decide judgment error precedence in one place
scope: backend-domain
status: needs-review
---

"Unavailable outranks pending" is decided in `judgment.Assess`, again when `judgePayments` and `judgeSelectedPayments` aggregate 100-item batches, and again in `scanPaymentJudgments` when final findings are scanned. The comments on the incremental helpers explicitly say they match `judgment.Assess`, so drift is currently managed by prose rather than code.

Add one helper in the judgment package that maps a set of statuses to the deferred error and one that aggregates batch errors, then call it from all four sites. Keep the incremental path's reuse of carried-forward judgments; only the precedence decision moves.

Verify with a parameterized regression over full recompute, incremental with more than 100 candidates, and incremental with carried findings, using a mix of ready, pending, and unavailable statuses. The existing full-versus-incremental parity test must stay green unchanged. Whether a carried finding can change status without a new request was not checked; if it can, cache invalidation also needs review.

References: `backend/internal/judgment/assess.go:51-62`; `backend/internal/analysis/payment_judgment.go:15-27`; `backend/internal/analysis/payment_incremental.go:338-352,524-553`.
