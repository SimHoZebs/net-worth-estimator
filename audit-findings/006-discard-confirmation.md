---
id: 006
title: Use an alert dialog for discard confirmation
scope: frontend-state
status: accepted
---

Priority: medium-high.

Closing a dirty editor replaces footer content with a hand-styled inline warning and Continue/Discard buttons. Receipt review implements another inline confirmation. These are still custom confirmation flows after the surrounding modal was migrated. An inline alert announces text; it does not provide the focused decision and nested-dialog interaction of AlertDialog.

Compose discard confirmation with a nested AlertDialog and the preset cancel/action controls. Share that composition where the close contract is the same, while keeping each editor's dirty detection, busy guard, failed-save state, and unload protection. Do not claim the library supplies dirty tracking or financial validation.

References: `frontend/src/components/editors/EditorForm.tsx:32`, `frontend/src/components/editors/EditorForm.tsx:107`, `frontend/src/components/receipts/ReceiptReviewDialog.tsx:187`, `frontend/src/components/receipts/ReceiptReviewDialog.tsx:203`. Official primitive: https://base-ui.com/react/components/alert-dialog.

Verification: Cancel/close/backdrop/Escape request confirmation once; Continue preserves values and returns focus; Discard closes; failed saves remain retryable; busy mutations cannot accidentally dismiss; nested Escape affects only the topmost layer.
