# Backend Migration Assumptions

Living document. Every non-obvious decision made while porting the TypeScript domain to the Go backend (chi + huma + SQLite) is recorded here.

## Architecture

- A1. The Go binary is the single source of computation and persistence. SQLite (WAL, `modernc.org/sqlite`) replaces browser localStorage, IndexedDB artifact storage, and the Vite dev CSV API. CSV files under `public/configs/` and `public/data/income/` become seed/import data only.
- A2. Computation is stateless per request. Requests carry `{document?, overrides, settings, config}`; overrides remain session-only client state applied server-side per request, never persisted.
- A3. Storage sits behind an internal DAO seam so the driver can be swapped later (e.g. Turso `tursogo`). Chosen default is boring/mature over MVCC/concurrent-write features this app never exercises (single process, low write volume).
- A4. Stochastic progress streams over SSE (`text/event-stream`) mirroring `StochasticWorkerProgress {progress, partial?}` 1:1, batches of 50 preserved. Job+poll fallback exists via `GET /v1/projections/{jobId}`.

## Wire format

- A5. Account bounds use the canonical FINITE sentinel constants (`NO_FLOOR=-1e13`, `NO_CEILING=+1e13` from `constants.ts`) on the wire, in SQLite, and in the kernel; the TS Zod schema requires finite numbers, so null/Infinity would be rejected. CSV sentinels map to these values at import.
- A6. `IsoDate` values remain `"YYYY-MM-DD"` strings everywhere.
- A7. `ProjectionPath.projectionStartPostingState` maps serialize as plain JSON objects over the wire (the TS version holds `Map`s which would also serialize lossily); it is consumed internally by FI branch simulation, not by the UI.
- A8. Evaluation result envelopes keep `deterministic`/`probabilistic` as arbitrary JSON (`JsonValue`), matching TS.

## Numeric parity

- A9. Arithmetic (+,-,*,/) on IEEE-754 doubles is bit-exact between V8 and Go.
- A10. Transcendentals (`log`, `exp`, `sqrt`, `cos`, `pow`) may differ by ULPs between V8 and Go math. Golden tests therefore compare exactly for integer/simple-arithmetic paths and allow relative tolerance 1e-12 only where transcendentals feed the value (growth compounding, log-normal sampling, FI expense inflation).
- A11. The LCG `(state*1664525 + 1013904223) & 0x7fffffff` is exact in doubles because intermediate products stay below 2^53; Go reproduces it with int64 math + mask, bit-for-bit.
- A12. `Math.round` rounds half toward +∞ like Go's `math.Round`; used identically for currency rounding.

## Dates

- A13. Monthly cadence uses clamped month addition (Jan-31 + 1mo = Feb-28), replicated from `addMonthsClamped`; Go's `AddDate` overflow semantics are never used for cadence.
- A14. Day arithmetic uses UTC days; `daysBetween` rounds the ms difference like TS.

## Semantics preserved verbatim

- A15. Same-date ordering: ascending priority then ingestion (file) index. Checkpoints overwrite observed balances after same-date postings during historical replay and emit no movements.
- A16. Enabled `once` postings strictly before the projection start replay through shared transitions; a `once` on the start date remains a projected event unless a checkpoint shares the start date (then it is historical and start-date events are suppressed).
- A17. Structural classification (source/destination presence) selects inflow/outflow/transfer. No ID/label/category branching anywhere.
- A18. Evaluation registry pattern retained: definitions keyed by `EvaluationType` in a map; unknown types surface per-instance error diagnostics.
- A19. FI logic: monthly candidate schedule, summary cycles stop at first shortfall, detailed rerun only for the selected candidate, branches replay only explicitly selected continuing postings.
- A20. Monte Carlo samples annual rates per posting/year up-front (counts derived from occurrence scan), one prepared request reused for baseline + every sample; exact percentiles from merged sorted arrays.

## Deviations / pragmatic cuts

- D1. CSV parsing diagnostics differ in wording/path shape from Zod's messages at import time only; once data is in SQLite, GET returns the same issue codes produced by the ported validators. Canonical document shape and severity semantics are identical.
- D2. The Vite plugin (`plugins/csvFilePlugin.ts`) is retired rather than proxied; the Go server serves `/api/*` in dev via vite proxy during migration.
- D3. Browser persistence paths (localStorage DAO, Web Locks, IndexedDB artifacts) are deleted at cutover; artifact identity hashing is recomputed in Go, so previously cached browser artifacts are abandoned (they were disposable by design).
- D4. `accessors.ts` helpers are UI-selection utilities and are not ported; the API returns full result collections.
- D5. Analyses pipeline ports observation derivation, shared classification plan, payroll detection, and salary estimation faithfully; classifier wording/labels are preserved.

## Implementation notes (recorded during the build)

- N1. Movement `accountDeltas` order follows model account declaration order (TS object insertion order), with unknown accounts appended sorted. This is observable in fulfillment events and movement payloads.
- N2. Empty arrays are always emitted (`diagnostics`, `checkpointCorrections`) to match TS JSON shapes; nil slices are normalized before marshalling.
- N3. Client artifact-cache version bumped to 2: the cached engine now stores one deterministic artifact per `{base inputs, evaluations}` descriptor instead of the old base/evaluation split, because evaluation-only reruns moved server-side.
- N4. Dormant TS modules retained but unreferenced after cutover: `src/workers/` was deleted along with `WorkerProjectionEngine*`; browser persistence modules (`localStorageFinancialModelDao`, IndexedDB store, bundled CSV sources, Vite CSV plugin) remain in-tree unused pending cleanup. `vite.config.ts` no longer loads the CSV plugin; `/v1/*` proxies to the backend.
- N5. Dev topology: Go server on `:8787` (env `PORT`, `NET_WORTH_ESTIMATOR_DB`; seed paths default `public/configs` + `public/data/income`), Vite on `:5173` proxying `/v1`. Production: single Go binary serving the built frontend plus APIs (embed step is follow-up).
- N6. Golden harness: `src/lib/projection/__tests__/__goldenDump.test.ts` writes fixture pairs when `GOLDEN_DUMP_DIR` is set; `backend/internal/domain/golden_test.go` replays them. Current coverage: deterministic projection, checkpoint replay, income pipeline, seeded stochastic bands. All pass with exact float equality except sampled percentile values within 1e-9 relative tolerance (A10).
- N7. CSV destination lists use semicolon separators for multi-destination rows (matches TS serializer); JSON arrays also accepted on import.
- N8. `POST /v1/projections/stochastic` streams SSE events: `progress`, `partial` (batch of 50), terminal `result` or `error`. Unseeded runs receive a concrete seed from the client cache layer, preserving one-persisted-outcome semantics.
- N9. Wire-format strictness: two mismatches were found by running the app's own Zod parser against the live API and fixed — bounds must be finite sentinels (see A5 revision) and provider input bindings must always emit `arguments` (custom MarshalJSON; literal bindings emit only `{source,value}`).
- N10. Live parity harness: `src/lib/projection/__tests__/__liveBackend.test.ts` fetches `/v1/financial-model` from the running backend through the Vite proxy and drives it through the production parser + full TS engine. It is the authoritative "app loads" check.
- N11. Server artifact cache wired: `POST /v1/projections/deterministic` and `/v1/projections/stochastic` consult `projection_artifacts` keyed by SHA-256 of `{document, overrides, settings (dates+horizon+enabled evaluation configs), incomeData, config}`. Responses carry `X-Cache: hit|miss`; SSE hits stream a single `result` event. Identity is versioned and Go-owned; label-only edits and disabled-evaluation config changes do not invalidate. Concurrent identical misses race benignly (`ON CONFLICT DO NOTHING`).
- N12. Review-driven hardening: cache keys hash the RESOLVED stored document/income snapshot (omitted-body requests track model saves); unseeded stochastic runs bypass the cache entirely (nil seed = fresh draw); CSV import rejects non-finite bound spellings other than exact Infinity sentinels and requires finite checkpoint balances; artifact eviction is kind-agnostic (bounded across stochastic entries too); `sql.ErrNoRows` handled via errors.Is.
