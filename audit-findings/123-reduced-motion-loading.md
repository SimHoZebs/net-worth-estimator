---
id: 123
title: Stop repeating loading animations with reduced motion
scope: ui-ux
status: accepted
---

The reduced-motion stylesheet makes animations extremely short. Loading indicators that repeat indefinitely still repeat indefinitely, which can leave motion or flicker where a user asked for reduced motion.

Limit animations to one iteration in the existing reduced-motion rule so repeating loading indicators settle.

## References

- `frontend/src/styles/accessibility.css:2-9` shortens animations without limiting iterations.
- `frontend/src/components/ui/skeleton.tsx:7`, `frontend/src/components/ProjectionUpdating.tsx:5-10`, and `frontend/src/components/receipts/ReceiptExtractionAction.tsx:25-30` use repeating loading indicators.

## Verification

Source inspection confirms the global override changes duration but does not change repetition. Visual behavior was not tested.

Emulate reduced motion during loading, projection updates, and receipt extraction. Verify that animations settle, status text and busy-state announcements still work, and the default motion setting behaves as before.
