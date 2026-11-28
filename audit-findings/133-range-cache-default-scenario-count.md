---
id: 133
title: Align the browser and server range scenario count
scope: backend-api-persist
status: implemented
---

The browser requests 400 scenarios for a range. New server state defaults to 1,000, and the server requires the counts to match before reading or building the saved range. Even when the remaining settings match, the normal browser request computes directly instead of reusing saved results.

Align the server's default and the browser's normal request around the current 400-scenario workload. Handle existing state whose range settings have never been set, and preserve existing saved ranges configured for another count.

## References

- `frontend/src/state/useRemoteProjection.ts:526-528,882-893` sends the browser's scenario count.
- `backend/internal/types/projection_unified.go:186-192` and `backend/internal/store/adapters/sqlite/projection_unified.go:50-74` set and normalize the default.
- `backend/internal/api/projections/builder.go:1157-1162,1297-1305` checks the count.

## Verification

Source inspection confirms the defaults disagree. No production hit rate or compute time was measured.

Verify with a fresh store and a fixture with unset range settings that the normal saved-model request persists results and an identical second request reuses them. Check that requests with a different scenario count still compute correctly.

Implemented in commit `5439ddc0`.
