---
id: 025
title: Share the viewport subscription
scope: frontend-state
status: implemented
---

The registry sidebar uses effect/state matchMedia while the app already provides a useSyncExternalStore viewport hook. Both identify the mobile/desktop boundary.

Use useMediaQuery(viewportQueries.belowMd) in the sidebar and delete use-mobile. Keep canonical Sidebar rather than rebuilding its mobile modal behavior.

**Weight:** small recommended consolidation. Registry updates may restore the deleted hook. The old predicate is max-width 767px and the shared one width below 48rem, so check fractional widths/font settings rather than claiming exact equivalence.

## References

- `frontend/src/hooks/use-mobile.ts:1-22` defines the duplicate subscription.
- `frontend/src/state/useMediaQuery.ts:3-37` supplies the shared owner.
- `frontend/src/components/ui/sidebar.tsx:69` consumes the registry hook.

## Verification

Implementation verified by typecheck and recorded 390px mobile sidebar open/Escape/desktop transitions. Fractional-width and custom browser-font boundaries were not exercised.

Check initial render, transitions around 768px including fractional widths, and focus/dismissal while resizing. Preserve desktop collapse and mobile open state. Run typecheck/current sidebar checks.
