---
id: 128
title: Correct the Analysis input retention guide
scope: doc-audit-reference
status: needs-review
---

The Analysis guide says each run saves a reproducible input snapshot that can preserve deleted transaction evidence. The worker loads the input into memory for computation, but the run table retains the input revision and run metadata rather than a copy of that input.

Correct the lifecycle, persistence and privacy sections to distinguish the in-memory input from records kept in the database. Preserve the warnings about sensitive retained facts, feedback, database backups and write-ahead logs.

## References

- `docs/analyses.md:13-18,34-46,56-65` makes the persisted-input claims.
- `backend/internal/store/adapters/sqlite/analysis_schema.go:12-24` defines run metadata.
- `backend/internal/store/adapters/sqlite/analysis_runs.go:21-72` loads input and creates the run.
- `deploy/MIGRATIONS.md:57` records removal of the stored input column.

## Verification

Source comparison confirms the run schema has no input snapshot column. No production database was inspected.

Cross-check the updated retention statements against the current schema, worker and migration contract.
