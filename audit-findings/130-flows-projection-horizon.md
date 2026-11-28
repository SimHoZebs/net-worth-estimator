---
id: 130
title: Request only the projection years Flows needs
scope: frontend-domain
status: implemented
---

Flows requests a projection long enough to cover the selected dates. It counts calendar years touched by the window, but the server measures whole years from the projection start. A window from January 2, 2026 through January 1, 2027 therefore requests two years even though one reaches January 2, 2027.

Reuse the existing anniversary helper to request the smallest supported number of years that reaches the end of the selected window.

## References

- `frontend/src/state/useFlowGraph.ts:24-33,161-169` chooses and sends the horizon.
- `frontend/src/domain/result.ts:135-147` owns the anniversary calculation.
- `backend/internal/domain/prepare.go:392-423` uses the start date to determine the projection end.

## Verification

Source comparison confirms the discrepancy. No runtime savings were measured.

Test windows ending before, on and after the anniversary, including a leap-day start. Compare the graph before and after the change to confirm all in-window transactions are still included.

Implemented in commit `91ac5165`.
