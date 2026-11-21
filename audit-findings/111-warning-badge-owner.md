---
id: 111
title: Own the transaction warning badge in one place
scope: ui-ux
status: needs-review
---

"Excluded from account" and "Shortfall" use warning surface and text tokens on the badge in list rows but a plain secondary variant in the detail sheet opened from those rows. The same concept gets two visual treatments at two depths, and each new consumer copies the override string. Prior finding 052 covered the success badge, not this one.

Add one warning status badge variant or a single status-badge owner and use it at all sites.

Verify by rendering one excluded or shortfall transaction in the row, the detail sheet, and the modal table and comparing computed classes and labels. No browser render was performed for this audit.

References: `frontend/src/components/activity/TransactionRow.tsx:155-170`; `frontend/src/components/activity/TransactionDetail.tsx:1084-1092`.
