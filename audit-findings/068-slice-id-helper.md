---
id: 068
title: Share one slice-ID filter helper in the SQLite adapter
scope: backend-api-persist
status: accepted
---

Every projection artifact is stored per slice. Six methods — `SaveGeneratedTransactions`, `ListGeneratedTransactions`, `DeleteGeneratedTransactions`, `ListProjectionRows`, `DeleteProjectionRows`, and `DeleteMonteCarloStatistics` — each allocate a `placeholders []string` and `args []any`, fill them from `sliceIDs`, and join them into an SQL `IN` clause. The same pattern appears twice in `ProvisionSyncAccounts`, so this is an adapter-wide idiom rather than a one-off. Adding another slice-scoped artifact table means copying the loop again, and a change to placeholder or argument handling has to be applied at every site.

Add one private helper in the SQLite adapter that turns `[]string` into a comma-separated `?` list plus a `[]any` of the same values, and call it from all six projection methods and both provisioning queries. No SQL text or query ordering changes.

Verify that the existing projection conformance and integration tests pass unchanged, which proves argument order and slice filtering are preserved. This is a pure extraction, so add no new behavioral assertions.

References: `backend/internal/store/adapters/sqlite/projection_unified.go:312-326,362-368,412-418,442-448,471-477,488-494`; `backend/internal/store/adapters/sqlite/sync.go:253-259,283-289`.
