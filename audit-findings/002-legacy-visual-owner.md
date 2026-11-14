---
id: 002
title: Stop reapplying the legacy visual system
scope: ui-ux
status: accepted
---

Priority: high. This is the main mismatch with the requested migration.

The application button wrapper explicitly says legacy recipes remain the visual owner and Nova focus rings stay off. Direct primitive imports do not solve this elsewhere: editor-local class strings recreate the old dimensions, colors, and focus overrides after importing shadcn. Pills, alerts, empty states, progress, and skeletons retain competing implementations or styling recipes.

Delete the competing button and pill recipes and migrate callers to the preset's variants and sizes. Remove copied appearance strings from forms rather than merely moving them to another wrapper. Consolidate progress, skeleton, and empty-state compositions on the chosen primitives while preserving valid HTML nesting and useful accessible names. Let primitives own their focus appearance; scope any fallback focus styling to uncovered native elements and charts rather than imposing it on every control.

References: `frontend/src/components/Button.tsx:12`, `frontend/src/components/buttonStyles.ts:3`, `frontend/src/components/editors/AddTransactionDialog.tsx:30`, `frontend/src/components/SegmentedControl.tsx:64`, `frontend/src/components/EmptyState.tsx:32`, `frontend/src/components/Progress.tsx:12`, `frontend/src/styles/typography.css:54`.

Verification: a preset component reference and representative account/editor screens agree on control sizes, radii, selected states, and focus appearance in light/dark modes. Confirm loading placeholders retain valid phrasing/block contexts. A source scan should find no legacy button recipe or blanket preset-ring suppression. Layout utilities and intentional financial data formatting remain legitimate.
