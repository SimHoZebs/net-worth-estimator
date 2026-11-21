---
id: 107
title: Make the pattern-review tab strip scrollable
scope: ui-ux
status: needs-review
---

All seven other `TabsList` consumers pass `scrollable`, but the pattern-review strip does not. Inside the dialog at a narrow viewport the three status tabs can clip and the selected underline's paint space is not reserved. The owning recipe handles overflow and underline spacing only when the prop is set, and the component guide records that contract.

Add `scrollable` to that `TabsList`.

Verify at 360px that the strip scrolls horizontally and the underline and focus ring paint fully. No browser check was run for this audit, so the responsive claim is code-derived.

References: `frontend/src/components/analysis/PatternReview.tsx:372`; `frontend/src/components/ui/tabs.tsx:38-71`; `docs/ui-components.md:59-62`.
