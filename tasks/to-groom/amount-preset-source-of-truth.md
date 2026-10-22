# Fixed amount: use the saved recipe instead of rebuilding defaults

The `Fixed amount` recipe starts with expression `500`. After replacing its saved amount with `750`, selecting it can still rebuild `500` from the built-in template ID. The builder discards the selected recipe's stored description.

Use the saved amount description as the builder's starting value. Patch only fields the user edits. Custom recipes without controls must return their stored description instead of falling through to the fixed default. This replaces name-based reconstruction, not the existing field controls or formula engine.

- Factory/fallback descriptions: `backend/internal/store/schema.go:175-287`, `frontend/src/domain/amountCatalog.ts:76-244`.
- Rebuilt defaults: `frontend/src/components/editors/AmountBuilder.tsx:51-179,394-402`.
- Selection and replacement: `frontend/src/components/editors/AmountCatalog.tsx:120-134,177-188,371-383`.
- Existing tests: `frontend/src/domain/amountCatalog.test.ts:22-30`.

Test saved expression `750`, growth rate `0.05`, an opaque custom recipe, account-placeholder substitution, offline fallback, and JSON display/copy. After a one-field edit, assert that every untouched field remains equal. Accidental loss of saved fields is the main risk.
