---
id: 089
title: Correct the transaction sync key source path
scope: doc-audit-reference
status: accepted
---

The transaction-identity section points at `backend/internal/store/sync_pending.go`, which does not exist. The type lives under the SQLite adapter, and the same stale path is propagating into a grooming note.

Correct the pointer to `backend/internal/store/adapters/sqlite/sync_pending.go` in both places.

Verify with an existence check over backticked repository paths in the five reference documents. This was the only stale path; `/app/...` paths and bare filenames are intentional.

References: `TECHNICAL_OVERVIEW.md:328`; `tasks/to-groom/long-chaining/sync-snapshot.md`; actual file at `backend/internal/store/adapters/sqlite/sync_pending.go:12,17,34`.
