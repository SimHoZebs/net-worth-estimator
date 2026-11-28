---
id: 135
title: Publish saved range results atomically
scope: backend-api-persist
status: accepted
---

Rebuilding a saved range deletes the previous statistics, writes the new statistics slice by slice, and records completion separately. The reader accepts a nonempty set of statistics for the stored slices. A failed or concurrent rebuild can leave a range with only part of its dates available.

Replace the statistics and evaluation results in one transaction that checks the model revision and publishes completion. Read the published results from a consistent snapshot so each range uses one complete set.

## References

- `backend/internal/api/projections/builder.go:1216-1267,1329-1351` writes and reads the separate parts.
- `backend/internal/store/adapters/sqlite/projection_unified.go:250-270,472-481` implements statistics storage.
- `backend/internal/store/adapters/sqlite/projection_outputs.go:125-139` writes evaluation outputs.

## Verification

Source inspection confirms the write steps are separate and the reader does not verify completeness.

In a store test, simulate a write failure after one slice has been prepared and verify that no partial range is published. With a concurrent reader, verify every observed range has complete date coverage and results from the same revision.
