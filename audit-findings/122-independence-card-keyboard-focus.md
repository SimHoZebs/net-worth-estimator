---
id: 122
title: Show keyboard focus on the Financial Independence card
scope: ui-ux
status: implemented
---

The button that opens the Financial Independence inspector covers the full card. It has no explicit focus ring, and the card clips overflow at the button edge. That makes an outline drawn outside the button unreliable as a keyboard focus indicator.

Give the inspect button an inset focus ring using the existing focus colors. Preserve the separate controls over the card.

## References

- `frontend/src/pages/evaluations/FinancialIndependenceCard.tsx:96-111` renders the covering button.
- `frontend/src/components/ui/card.tsx:14` clips overflow.

## Verification

Source inspection confirms the button fills the clipped card and has no explicit focus indicator. Browser rendering was not checked.

Tab to the inspect button in light and dark themes and verify that its focus ring is visible inside the card. Use Enter to open the inspector and Escape to close it, then confirm focus returns to the inspect button.

Implemented in commit `e68bbbdc`.
