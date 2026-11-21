---
id: 067
title: Register a shared run only after the stream is writable
scope: backend-api-persist
status: needs-review
---

`stochasticSSE` calls `getOrStartSharedRun` before returning a `huma.StreamResponse`, so the run is registered in the package-global registry immediately. The stream's preamble runs later, when Huma invokes `Body`, and its first action is a type assertion for `http.Flusher`. On the non-Flusher path the handler writes `streaming unsupported` and returns without calling the `serve` callback. That callback is the only place that starts the owner's computation and calls `run.finish`, which closes `done` and evicts the key. A run registered for a non-writable stream therefore stays in the registry forever, and a later identical seeded request joins a run that can never finish or yield a result.

Move `getOrStartSharedRun` and the owner decision into the `serve` closure after the flusher check and set `Projection-Source` from inside that closure. A smaller alternative is a cleanup callback that removes `resultKey` whenever `stochasticStream` returns before invoking `serve`.

Verify with a writer that is not an `http.Flusher`: after the first request, a second identical seeded request must not report `Projection-Source: shared` and must complete with its own result, and the registry must have no entry for that key. The existing shared/owner tests cover only the happy path.

References: `backend/internal/api/projections/stochastic.go:82-91,107,174-180`; `backend/internal/api/projections/runs.go:38-50,97-104`; `backend/internal/api/projections/stochastic_test.go:87-99`.
