---
id: 108
title: Remove the duplicated sheet description
scope: ui-ux
status: needs-review
---

The suggestions sheet renders the same sentence twice: once as a screen-reader-only `SheetDescription` and again as a visible paragraph. Assistive technology reaches the same sentence twice and two strings must be kept in sync.

Keep the screen-reader-only description and delete the visible paragraph, or make the description visible once.

Verify that the phrase occurs once in the DOM and the sheet still has an accessible description.

References: `frontend/src/components/activity/TransactionDetail.tsx:1433,1438`.
