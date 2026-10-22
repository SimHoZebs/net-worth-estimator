# Model imports: report unsupported payment-term changes

The backend model supports debt payment settings such as `Prime Card` minimum `100`, percentage `0.02`, and due day `10`. The frontend import retains that property but emits no payment-term saves, then reports success. Imported debt behavior can therefore differ from the reviewed document.

Add the missing TypeScript payment-term contract and an import capability check. Reject unsupported additions, edits, or removals before the first save. Unchanged terms should not block imports. Reuse the [canonical-document decoder](model-import-boundary.md).

Full payment-term import is a larger alternative for grooming. It needs frontend client methods and compare/apply operations against existing backend endpoints. Ordinary adapter editing already passes through unknown source-document fields, so it is not the silent-loss path described here.

- Backend model/example: `backend/internal/types/model.go:228-250`, `backend/internal/domain/amount_terms_test.go:139-169,204-215`.
- Frontend omissions: `frontend/src/api/contracts.ts:228-235`, `frontend/src/api/rowSync.ts:103-138`.
- Success path and endpoints: `frontend/src/api/serverModelImport.ts:59-75`, `backend/internal/api/server.go:191-192`.
- Existing passthrough: `frontend/src/api/adapter.ts:1580-1588`.

Test added, edited, removed, and unchanged terms. Rejection must precede every row write. If full support is selected instead, verify account dependencies, operation order, and saved debt behavior after reload.
