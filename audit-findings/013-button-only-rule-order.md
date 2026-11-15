---
id: 013
title: Keep button ordering and remove drag ordering
scope: frontend-state
status: rejected
---

Recurring transactions already expose move-up/down controls. Drag ordering adds a second interaction with a handle, gesture snapshots, a ref mirroring draft state, drop settlement, and Motion Reorder components. Motion has no other frontend consumer.

Remove drag ordering and render the existing Item list with move buttons. Simplify the button path to the server move operation and refresh, retaining pending/error handling. Remove Motion after checking every workspace for imports. Keep execution order and the ability to change it; the dispensable feature is dragging, not financial ordering.

**Weight:** strong recommendation. Users move rules with buttons instead of dragging. Do not replace Motion with another drag library or handwritten pointer handling.

## References

- `frontend/src/components/activity/RecurringRules.tsx:11,67-110` defines the Motion drag row.
- `frontend/src/components/activity/RecurringRules.tsx:154-245` implements persistence, draft ordering, gesture lifecycle, and button moves.
- `frontend/package.json:40` declares Motion.

## Verification

Move both directions, check boundaries/read-only behavior, reload to verify saved order, and simulate failure. Preserve order across refreshes and do not promise atomic multi-move writes. Run affected tests, typecheck, and build. Capture button ordering when implemented.

## Decision

The user chose to retain drag ordering. Keep Motion, drag handles, gesture state, and the existing button alternative.
