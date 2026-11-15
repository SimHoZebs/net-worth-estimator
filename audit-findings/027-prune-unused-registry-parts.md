---
id: 027
title: Prune unused registry component parts selectively
scope: contracts-types
status: implemented
---

Generated primitives contain entire parts with no application/internal caller. These are upstream source, not custom interaction failures, but they add to the maintained source surface.

Delete proven-unused implementations, starting with dropdown groups/labels, radio groups/items, submenu parts, separator/shortcut, and FieldGroup/FieldSeparator. Remove newly unused imports. Keep internally called helpers even if nobody imports them externally. Further pruning needs an import graph, not just a list of unused public exports.

**Weight:** optional after dead app code. Pruning diverges from registry files and add/update may restore it. Bundlers may already remove unused exports, so no bundle saving is established. Keep live standard variants unless removing them materially simplifies code.

## References

- `frontend/src/components/ui/dropdown-menu.tsx:54-76,101-151,186-253` contains candidate implementations.
- `frontend/src/components/ui/field.tsx:41-52,149-177` contains unused group/separator parts.
- `frontend/src/components/ui/toast.tsx:187-239` shows externally unused parts required internally by Toaster; keep its render tree.
- `frontend/src/components/ui/sidebar.tsx:185-196` passes side to SheetContent; left-sheet support is live.

## Verification

Pruning verified by import/internal-use searches, typecheck/build, and current browser regression checks recorded in README.

Prove no direct, namespace, re-exported, dynamic, or internal use for every removed part. Run typecheck/build and representative menu/field/sheet/toast interactions. Keep select-label regression coverage. Do not remove Select items mappings assuming mounted option children always supply labels.
