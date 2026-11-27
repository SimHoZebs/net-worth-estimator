---
id: 119
title: Replay only recorded history when reading a saved projection
scope: backend-domain
status: needs-review
---

When the server serves saved projection results, it reconstructs the recorded portion of the timeline from the current saved model. The preparation routine also replays historical schedule occurrences to build a transaction ledger and spending-cap state. The saved-result reader uses only the recorded timeline and its balances.

Share the existing recorded-history preparation between saved-result reads and full projection preparation. Run the schedule replay only during full preparation. Keep projection validation and the cutoff used to select recorded evidence.

## References

- `backend/internal/api/projections/builder.go:1109,1352` attaches recorded history to saved results.
- `backend/internal/domain/path.go:318-330` returns only recorded rows and starting balances.
- `backend/internal/domain/prepare.go:305-320,375-404` runs both replays as part of full projection preparation.

## Verification

Source inspection traces the schedule replay to state the saved-result reader does not consume. No runtime timing was measured.

Compare recorded rows and starting balances before and after the change using multiple balance checks, backdated transactions and claimed schedule occurrences. Verify that full projection preparation still produces the same ledger and spending-cap state, and that both paths enforce the existing cutoff and validation.
