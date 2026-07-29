# Generic Table Typing Is Bypassed

Severity: Medium

## Evidence

- `src/components/ui/data-table.tsx:19-24` declares columns using `keyof TRow`.
- Active read-only account, posting, and checkpoint tables contain 24 production `as never` assertions.
- Callers recover row types with assertions, including `src/components/dashboard/tables/ReadOnlyPostingsTable.tsx:75-84`.

## Impact

Invalid or misspelled column keys can compile. Render callbacks lose useful value and row inference, weakening a reusable component intended to provide type safety.

## Minimal Recommendation

Explicitly bind each `DataTable` call to its row type and define columns with a typed `satisfies` expression or a key-aware column helper. Remove the redundant key assertion inside `DataTable`.

## Verification

- Remove all active `as never` and row recovery casts.
- Add a compile-time type test showing an invalid key is rejected.
- Run `npm run typecheck`.
