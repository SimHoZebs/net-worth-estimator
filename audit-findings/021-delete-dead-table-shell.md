---
id: 021
title: Delete the unused generic table shell
scope: contracts-types
status: implemented
---

DataTable and its column interface have no callers. The module is imported only for TablePagination. Live tables use TransactionTable or canonical Table directly.

Delete DataTable, DataTableColumn, and shell-only imports. Keep the pager until 015 settles its owner; name the remaining module for pagination. Do not install TanStack Table to justify an abandoned abstraction.

## References

- `frontend/src/components/DataTable.tsx:2-12,23-83` holds the unused shell.
- `frontend/src/components/cards/AccountDetailsModal.tsx:18` imports only the pager.

## Verification

Deletion verified by import searches and local cleanup checks recorded in README.

Repeat import/symbol searches. Run typecheck/lint and check account modal paging. Keep scroll regions and headers with live table compositions.
