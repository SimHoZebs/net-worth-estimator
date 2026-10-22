# Home renovation: use server shortfall evidence

`Home renovation` requests `9000`, receives `6350`, and has a shortfall of `2650`. The audit found that the browser discarded server payment evidence and recalculated coverage from account balances. That can hide a shortfall when account floors, destination ceilings, or annual limits protect some of the money.

Carry requested, realized, available, and constraint values into the existing `FundingGap` display model. Calculate shortfall as requested minus realized and use it for visibility. Label positive partial payments as partially funded. The account ledger supplies context, not another calculation of payment capacity.

On the server, add available funds to the existing `evaluatedMovementEvent` evidence record. Make `publicMovementEvents`, the public-response adapter, consume it instead of repeating balance reconstruction, sorting, and annual-limit tracking.

- Example and browser summary: `frontend/src/domain/fundingGaps.test.ts:47-68`, `frontend/src/domain/fundingGaps.ts:61-83,186-201`.
- Result mapping: `frontend/src/state/useRemoteProjection.ts:451-469`.
- Server duplication: `backend/internal/domain/evaluation_fulfillment.go:85-179`, `backend/internal/domain/path.go:94-180`.
- Existing constraint tests: `backend/internal/api/model_handlers_test.go:442-713`, `backend/internal/domain/posting_loss_test.go:159-219`.

Concurrent shortfall and chart work may already resolve this. Inspect the current inspector and `fundingGapChartModel` in `frontend/src/domain/chart.ts` first.

Verify floors, ceilings, historical annual-limit usage, negative returns, ordering, rounding, partial-payment copy, and chart meaning. A proposed regression uses balance `6350`, protected balance `2500`, and a payment requested at `5000` but funded at `3850`. The visible shortfall must come from server payment evidence. The main risk is confusing account balance with payment capacity.
