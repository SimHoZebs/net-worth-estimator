---
id: 105
title: Make auth feedback announce errors assertively
scope: ui-ux
status: needs-review
---

The auth feedback region keeps `role="status"` and `aria-live="polite"` even when `report()` sets an error, so client-side passkey errors are not announced assertively. Its `:empty { display: none }` rule also removes the live region until text is injected, which screen readers often miss. Error versus success is carried only by token colors, while the canonical `FieldError` uses `role="alert"`.

Switch the region to `role="alert"` when the tone is an error, keep it present but visually hidden while empty, and change only its text. Add a text or icon marker if color is the sole state cue.

Verify with a screen reader that a failed sign-in and a failed passkey action both announce assertively. No test depends on the current strings.

References: `auth/better-auth/src/pages.ts:44`; `auth/better-auth/src/client.ts:8-11`; `auth/better-auth/src/auth.css:23-31`.
