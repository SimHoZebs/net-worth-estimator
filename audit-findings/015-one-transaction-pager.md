---
id: 015
title: Use one transaction pager composition
scope: contracts-types
status: implemented
---

Transaction lists have three pagers: shared TablePagination, an inline Button copy, and an inline shadcn Pagination composition. Each repeats range text, previous/next controls, status, and boundary handling.

Use one small shared pager at all three sites. Existing TablePagination is the shortest starting point and already uses shadcn Button. Accept consistent preset appearance. Remove the unused Pagination module if the chosen composition no longer imports it. Alternatively recompose the shared pager once with Pagination, but do not expand identical upstream markup into every consumer just to remove a wrapper.

**Weight:** strong for consolidation, weak preference for existing native buttons. Disabled buttons avoid repeated aria-disabled/pointer-event handling. Optionally drop pager scrollIntoView behavior and leave focus at the activated button.

## References

- `frontend/src/components/DataTable.tsx:85-149` defines the shared pager.
- `frontend/src/components/cards/AccountDetailsModal.tsx:18,275` consumes it.
- `frontend/src/components/activity/Transactions.tsx:225-259` duplicates it.
- `frontend/src/pages/accounts/AccountSections.tsx:462-508` duplicates it through Pagination.
- `frontend/src/components/ui/pagination.tsx:36-61` implements alternative anchor-based controls.

## Verification

Implementation verified by local cleanup checks and browser captures recorded in README.

Page every list through boundaries, filter a later page down, and check empty/single-page states. Verify announcements and keyboard operation. If scroll jumps go, check focus stays useful. Keep zero-based state and clamping. Run typecheck and capture each affected paging workflow on implementation.
