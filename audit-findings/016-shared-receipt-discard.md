---
id: 016
title: Reuse the receipt discard confirmation
scope: frontend-state
status: implemented
---

Receipt review keeps its own discard boolean, dirty/busy close branch, beforeunload call, and AlertDialog tree. The shared editor module already owns this composition over Base UI.

Use useDiscardGuard and DiscardConfirm in receipt review. Keep draft revisions, conflict detection, receipt operations, and errors local. Accept shared wording. Preserve protection if an operation becomes busy while confirmation is open; the shared confirmation may need a small busy/disabled input rather than dropping existing checks.

**Weight:** strong recommendation. This merges duplicate application policy; Base UI alone does not determine whether an editor is safe to close.

## References

- `frontend/src/components/receipts/ReceiptReviewDialog.tsx:146-160,183,195-242` duplicates the composition.
- `frontend/src/components/editors/EditorDialog.tsx:28-82` supplies the shared implementation.

## Verification

Implementation verified by local cleanup checks and browser captures recorded in README.

Exercise clean/dirty close, Continue, Discard, busy close, busy starting during confirmation, failed saves with retained values, and reload protection. Keep revision/conflict behavior unchanged. Run typecheck/current receipt tests and capture confirmation on implementation.
