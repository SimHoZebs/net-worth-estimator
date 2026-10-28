# Financial independence: replace callbacks with a direct loop

The financial-independence evaluation tests retirement dates with a monthly calculation that continues selected transactions and funds expenses through withdrawals. Its generic `ReactiveBehavior` loop has only this one production caller, split across four callbacks and captured error state.

Replace those callbacks with a direct monthly loop in `evaluateCycleWithShared`. Call the existing shared transaction engine, `TransitionRuntime`, from that loop. Delete the generic wrapper and `baseEventsByDateAndPosting`, a map that is built and passed but never read. Use direct error exits instead of callback-captured errors.

- Wrapper: `backend/internal/domain/behavior.go:1-32`.
- Caller and unused state: `backend/internal/domain/evaluation_fi.go:336-432,494-495,552-751`.
- Required calculation boundary: `PRODUCT_INTENT.md:95`, `TECHNICAL_OVERVIEW.md` §§8, 9.

This overlaps [the existing branch task](../financial-independence-branch-simulation.md). Reconcile the two before scheduling. Reusing schedules across scenarios is a separate change, not a capability of the current per-path shared data.

Add eligible sustainable and shortfall cases, detailed/summary agreement, real/nominal principal preservation, negative sampled returns, and month-end ordering. Financial execution order is the main regression risk. The existing range golden has 25 financial-independence outcomes, all ineligible, so it does not verify the affected branch. The wrapper contains 32 lines, but no runtime or net line improvement is measured.
