---
id: 104
title: Restore focus and announce passkey removal
scope: ui-ux
status: needs-review
---

Removing a passkey calls `listPasskeys()`, which clears and rebuilds every list item. The focused Remove button is destroyed, so focus falls back to the document body. No success feedback is reported and the list has no live region, so a screen-reader user gets no confirmation and a keyboard user must tab from the top again.

Remove only the affected list item and move focus to the next Remove button or the add-passkey control, then report success. If rebuilding stays, add a polite live region to the list and set focus explicitly after the rebuild.

Verify with a keyboard journey: tab to Remove, press Enter, confirm focus lands on a known control and the removal is announced. Keep `auth.test.ts` green. No screen-reader session was run for this audit, so the announcement failure is reasoned from markup rather than observed.

References: `auth/better-auth/src/client.ts:42-43,53-60`; `auth/better-auth/src/pages.ts:47`.
