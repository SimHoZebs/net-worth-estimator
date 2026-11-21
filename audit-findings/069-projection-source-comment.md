---
id: 069
title: Correct the projection source comment
scope: backend-api-persist
status: accepted
---

The constant that labels a result's origin is documented as "Every projection computes directly: no stored results exist." The same file's canonical read path first tries `readDeterministic`, which assembles a result from stored slices, rows, and evaluation outputs, and labels that cache hit `computed`. The header is deliberately single-valued, and `TESTING.md` states deterministic requests always report `computed`, so this is not a request to change the wire contract. It is a stale comment that would lead a maintainer to treat the whole read-and-build orchestration as dead code.

Correct the comment to say that `computed` marks a result derived from the canonical model, whether computed on this request or assembled from a stored build, and that only `shared` marks attachment to an in-flight stochastic run. Leave the constant values and the `TESTING.md` statement as they are.

Verify with `go test ./backend/internal/api/projections/...` and a grep that no source still claims stored results do not exist. No header value should change.

References: `backend/internal/api/projections/deterministic.go:15-19,66-88`; `backend/internal/api/projections/stochastic.go:174-177`; `TESTING.md:305,323`.
