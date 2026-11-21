---
id: 112
title: Bound transaction title truncation by the container
scope: ui-ux
status: needs-review
---

The shared transaction row caps its title with `max-sm:max-w-[calc(100vw_-_13rem)]`, where `13rem` is a guessed clearance for date, amount, and icon. The same row renders inside the account-detail dialog and detail sheets, where `100vw` is not the row's width, so titles truncate too early on desktop and not at all in a narrow dialog.

Remove both the character cap and the viewport-relative override, keep `min-w-0` on the flex child, and let the existing fixed table columns bound the text.

Verify at 360px and desktop with a long title in the page table, the account dialog, and the detail sheet. These responsive claims are code-derived and require visual confirmation.

References: `frontend/src/components/activity/TransactionItem.tsx:85-94`; `frontend/src/components/cards/AccountDetailsModal.tsx:136`.
