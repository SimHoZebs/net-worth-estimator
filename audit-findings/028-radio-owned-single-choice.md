---
id: 028
title: Use a single-choice control for the movement filter
scope: ui-ux
status: implemented
---

The Money filter represents exactly one of All, Recorded, or Planned. It passes an array to ToggleGroup and manually searches changes to prevent deselection.

Use existing RadioGroup/RadioGroupItem and accept radio appearance. Remove array searching/deselection handling. Keep selected MovementFilter as application state because it drives data filtering.

**Weight:** optional small simplification. Radio naturally owns exclusive selection but may add label markup. Check the diff; do not rebuild a segmented-control style framework to preserve the old look.

## References

- `frontend/src/pages/flows/FlowFilters.tsx:80-101` implements the array conversion/guard.
- `frontend/src/components/ui/radio-group.tsx:1-35` supplies exclusive selection.

## Verification

Implementation verified by a pointer/ArrowDown recording changing Recorded to Planned with exactly one checked radio, plus local checks recorded in README.

Check each option by pointer/keyboard, one selected option, unchanged domain filtering/totals, labels, and narrow layout. Run typecheck and capture the changed filter on implementation.
