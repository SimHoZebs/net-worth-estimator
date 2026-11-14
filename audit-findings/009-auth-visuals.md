---
id: 009
title: Bring server-rendered auth into the visual system
scope: backend-api-persist
status: accepted
---

Priority: medium.

The uncommitted auth repair replaces imports of deleted frontend recipes with local copies of their old class strings. This repairs the source dependency but preserves the retired visual system in a second owner. Dynamically rendered passkey controls still use the retained old button recipe.

Align server-rendered HTML with the same preset tokens and control recipes as the frontend. Share a small build-time styling source or generated CSS where needed rather than copying the retired strings. These pages are plain HTML, so they need visual parity, not a forced React runtime or unnecessary custom keyboard behavior. Keep form actions, names, autocomplete, CSP, CSRF protection, and passkey behavior unchanged.

References: `auth/better-auth/src/pages.ts:1`, `auth/better-auth/src/pages.ts:41`, `auth/better-auth/src/client.ts:4`, `auth/better-auth/src/client.ts:50`, `auth/better-auth/build.ts:18`, `auth/better-auth/src/auth.css:1`.

Verification: build the auth CSS, compare sign-in/sign-up/device/passkey screens in both themes, verify dynamic and static buttons match, and run auth form/security coverage. The inspected dirty change does not alter backend or financial domain contracts.
