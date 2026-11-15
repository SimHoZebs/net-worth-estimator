---
id: 031
title: Share the application and sign-in brand recipe
scope: ui-ux
status: implemented
---

The React header and server-rendered sign-in pages duplicate the same brand link, mark, icon classes, and SVG path. Shared React-free control recipes already bridge these two renderers.

Move the brand strings to one React-free module consumed by both renderers. Keep routing and HTML construction local. This is a small maintenance consolidation, not a replacement for the product mark with a shadcn component.

**Weight:** low priority. Require a net reduction or a clear ownership benefit; introducing a module may offset the few removed lines. No appearance change is needed.

## References

- `frontend/src/components/Brand.tsx:3-7` defines four strings.
- `auth/better-auth/src/controls.ts:34-39` duplicates them.
- `auth/better-auth/src/controls.ts:11` already imports React-free shared control recipes.

## Verification

Shared strings remain identical. Auth typecheck/build/tests and all four image contracts pass, including shared-file COPY/reuse inputs.

Compare rendered header/sign-in marks and server HTML before/after, run both workspaces' typechecks/builds, and confirm the server imports no React runtime. Update auth image inputs if a new shared file is outside their current copy boundary.
