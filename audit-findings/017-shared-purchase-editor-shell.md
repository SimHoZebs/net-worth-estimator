---
id: 017
title: Reuse the purchase editor dialog shell
scope: frontend-domain
status: implemented
---

The purchase editor uses the shared discard hook but repeats Dialog, header, form, error, Cancel/Save footer, and DiscardConfirm. EditorDialog already composes these responsibilities.

Render purchase fields through EditorDialog. Keep validation, read-only notice, funding choices, mutation, and draft local. Accept shared width and buttons instead of adding props solely to preserve 2xl width and the current Cancel variant.

**Weight:** recommendation. This removes repeated composition without introducing a form framework. Adapting submit must preserve native submission and repeated-save protection.

## References

- `frontend/src/pages/purchase-planner/PlannedPurchaseEditor.tsx:88-93,140-164,244-269` repeats the shell.
- `frontend/src/components/editors/EditorDialog.tsx:89-154` owns dialog/form/footer composition.

## Verification

Implementation verified by local cleanup checks and browser captures recorded in README.

Create/edit, submit with Enter, check read-only state, retry failure without losing input, and exercise dirty dismissal. Check long-form scroll on narrow screens. Run typecheck/purchase tests and capture the workflow on implementation.
