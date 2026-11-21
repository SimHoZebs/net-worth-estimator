---
id: 066
title: Remove the no-op store conformance check
scope: backend-api-persist
status: accepted
---

The Store conformance suite advertises a check named `ArtifactsRoundTripAndKeepFirstWrite`, but its body is empty. The suite is the contract gate callers use to judge any Store implementation, so an always-passing entry gives false coverage. The name refers to the retired artifact model; the current persistence seam exposes projection state, slices, rows, and evaluation outputs instead.

Remove the empty `t.Run` block. If first-write persistence still matters for the current projection state, replace it with a real conformance test against `SaveProjectionState` or `GetProjectionState` that asserts the current upsert behavior rather than the retired artifact rule.

Verify that `go test ./backend/internal/store/adapters/sqlite/...` stays green and the conformance test list no longer contains an always-passing entry. If a replacement is added, it must fail against a deliberately broken `SaveProjectionState` implementation.

References: `backend/internal/store/storetest/contract.go:79-80`; consumers of the validated allow-list at `backend/cmd/server/main.go:41-42,113`; current seam at `backend/internal/store/store.go:174-188` and `backend/internal/store/adapters/sqlite/projection_unified.go:36-61`.
