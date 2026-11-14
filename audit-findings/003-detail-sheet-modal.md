---
id: 003
title: Let the detail sheet own modal behavior
scope: frontend-state
status: accepted
---

Priority: high. Accessibility semantics are being selected partly to preserve test assertions.

The transaction detail sets `modal={false}` and `disablePointerDismissal`. Its comment specifically cites keeping the account list in the accessibility tree so list assertions work while the detail is open. That preserves an old test contract rather than establishing the intended sheet interaction. An outer `DetailPortal` duplicates portal ownership, while the shared sheet adds a custom initial-focus-to-container default absent from the checked upstream component.

Use the standard modal sheet as the default detail composition, with nested menus/dialogs inside its React ownership. Remove the extra portal when the primitive owns placement. Move any justified initial-focus exception to that particular workflow. Keep the touched-edit close guard, save outcomes, and route-driven open state. If background interaction is genuinely intended, specify and test that product behavior explicitly rather than retaining it for old assertions.

References: `frontend/src/components/activity/TransactionDetail.tsx:163`, `frontend/src/components/activity/TransactionDetail.tsx:1443`, `frontend/src/components/ui/sheet.tsx:40`, `frontend/src/components/ui/sheet.tsx:57`. Base UI state/focus/nesting documentation: https://base-ui.com/react/components/dialog.

Verification: keyboard opening, initial focus, containment, return focus, backdrop dismissal, dirty close, and topmost-only Escape for a select, menu, and nested confirmation. Inspect accessibility-tree background behavior on desktop and mobile. The audit confirms the opt-outs; it does not claim a browser-reproduced focus failure.
