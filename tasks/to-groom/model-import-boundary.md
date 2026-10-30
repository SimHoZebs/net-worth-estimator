# Model imports: decode the complete document before preview

The import parser accepts a `Cash` model that omits account-balance evaluations, then promises a complete document type. The preview reads the missing array's length. Scheduled-transaction comparisons have the same problem with an omitted rules array.

Replace the partial type predicate with one canonical-document decoder at the import boundary. Zod already exists. Decode fields required by preview and save comparison, while preserving unknown server fields and opaque evaluation configuration. The display-plan schema describes a different contract.

Reject missing arrays before preview. Invalid supplied values must not silently become defaults. No legacy file shape is supported.

- Partial checks and fixture: `frontend/src/api/modelImport.ts:12-74`, `frontend/src/api/modelImport.test.ts:10-31`.
- Required shape: `frontend/src/api/contracts.ts:220-235`.
- Consumers: `frontend/src/components/imports/ModelImportPreview.tsx:35-40`, `frontend/src/api/rowSync.ts:226-235`.

Test preview and save comparison with missing arrays, malformed entries, and preserved extra fields. Coordinate the decoder with [payment-term capability checks](model-import-payment-terms.md). Financial cross-validation still belongs to the server.
