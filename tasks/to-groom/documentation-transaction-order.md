# Transaction documentation: correct ordering and annual-limit ownership

Assumption A13 describes older ordering and limit behavior. Current execution places one-time transactions before scheduled transactions on the same day. Annual limits belong to scheduled transaction definitions.

Correct A13 while preserving its identifier. State one-time order as transaction time, posted time, then ID, and scheduled order as priority, then declaration sequence. The technical overview owns the full mechanics. Document negative sourceless growth there too: a negative return can reduce assets rather than clamp to zero.

- Stale invariant/detail owner: `docs/backend-migration/ASSUMPTIONS.md:28`, `TECHNICAL_OVERVIEW.md:284-289,326`.
- Ordering/limits: `backend/internal/domain/recurrence.go:26-57,293-303`, `backend/internal/domain/transitions.go:157-166`.
- Negative growth/test: `backend/internal/domain/transitions.go:186-199`, `backend/internal/domain/posting_loss_test.go:73-91`.

Compare the prose with shared sorting and execution. The existing negative-return test expects `12000 → 11880` for sampled annual rate `-0.12`. This task corrects descriptions, not financial calculations or golden values.
