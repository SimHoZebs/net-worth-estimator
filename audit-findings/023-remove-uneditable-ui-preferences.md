---
id: 023
title: Remove persisted projection controls that no UI edits
scope: backend-api-persist
status: implemented
---

The UI store persists projection years/ranges with sanitization/merge logic, but no production control calls either setter. Projection hooks inherit hidden persisted values; purchase planning reads the horizon for a display date.

Use an explicit shared default horizon and explicit range options at projection callers. Remove setters, persistence middleware, key-specific handling, sanitizer, and tests dedicated to the retired preference. Keep browser-storage support for other live stores. The independent unread import flag is finding 024.

**Weight:** recommendation for adjacent UI-state cleanup, not a shadcn replacement. Previously stored non-default values stop affecting the app. Preserve projection semantics and all server-owned financial selections.

## References

- `frontend/src/state/uiStore.ts:10-57` owns the preferences/plumbing.
- `frontend/src/state/useRemoteProjection.ts:715-716` reads fallbacks.
- `frontend/src/pages/purchase-planner/PlannedPurchasePanel.tsx:48` reads years.
- `frontend/src/state/persisted.ts:4` declares the key.

## Verification

Implementation verified by projection/persistence tests and local cleanup checks recorded in README.

Repeat production setter searches excluding tests. Audit all projection callers. Run projection/default-horizon and persisted preference tests, updating only removed-preference cases. Check cache keys, purchase horizon display, and financial selections. Do not add storage migration/fallback code.
