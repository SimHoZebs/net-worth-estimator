---
id: 089
title: Correct the transaction sync key source path
scope: doc-audit-reference
status: accepted
---

## Executive summary

The transaction-identity section points at `backend/internal/store/sync_pending.go`, which does not exist; the type lives under the SQLite adapter. The same stale path is propagating into a grooming note. A reader following the pointer hits a missing file. The recommended action is to correct the pointer in both places.

## Recommended action

Correct the pointer to `backend/internal/store/adapters/sqlite/sync_pending.go` in the transaction-identity section and in the grooming note.

## Before and after

| Before | After |
| --- | --- |
| Pointer to the non-existent `backend/internal/store/sync_pending.go`. | Pointer to `backend/internal/store/adapters/sqlite/sync_pending.go`, where the type actually lives. |

```mermaid
flowchart LR
  P[reference doc] -->|before| M[missing path]
  P -->|after| R[SQLite adapter path]
```

## Expected improvement

Structural and documentation-only. The reference resolves to a real file, so readers can follow it. No runtime behavior changes, and no benchmarks were run, so no speed or size improvement is claimed.

## Alternatives considered

- Leave as is. Rejected because readers following the pointer hit a missing file and the error is spreading to new notes.
- Move the source file to the documented path. Rejected because that changes the runtime layout to fix a documentation error.

## Downside of rejecting

The pointer stays broken and continues propagating into new notes, wasting reader time.

## Verification

Run an existence check over backticked repository paths in the five reference documents. This was the only stale path; `/app/...` paths and bare filenames are intentional. This is a proposed acceptance check.

References: `TECHNICAL_OVERVIEW.md:328`; `tasks/to-groom/long-chaining/sync-snapshot.md`; actual file at `backend/internal/store/adapters/sqlite/sync_pending.go:12,17,34`.
