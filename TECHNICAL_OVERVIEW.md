# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a React application that loads a `FinancialModelDocument` from a Go backend, validates it, and projects net worth and financial-independence outcomes. Deterministic and Monte Carlo computation runs in the Go backend; the browser never simulates.

## 1. Tech Stack

- React 19, Vite, and TypeScript
- Go backend (chi + huma) for model persistence and projections
- Tailwind CSS v4 and uPlot
- Zustand and TanStack Query
- Papa Parse and Zod
- Vitest

## 2. Data Flow

1. `App.tsx` creates `createHttpFinancialModelRepository()` and `createHttpIncomeDataSource()`. The browser uses same-origin `/v1` routes unless the Vite build sets `VITE_API_BASE_URL`; the development server proxies `/v1` to `NET_WORTH_ESTIMATOR_BACKEND` (default `http://localhost:8787`).
2. Model Inputs and query hooks depend only on `FinancialModelRepository`, implemented by `createHttpFinancialModelRepository` against the Go backend. There is no client CSV parsing; the HTTP layer keeps thin wire-shape parsers (`sources/http/documentParser`, `sources/http/incomeSnapshotParser`) and the browser never loads model CSVs directly.
3. The backend validates the `FinancialModelDocument` and returns diagnostics with the payload. The client renders those server-provided diagnostics; it performs no business-rule validation of its own. Invalid or malformed data surfaces diagnostics instead of being silently discarded.
4. The Zustand Editor slice stages a session-only draft (`workingDocument` plus the `editingBaseline` snapshot in `src/store.ts`), displayed as current changes. The effective document is `workingDocument ?? canonical document` (`src/runtime/useProjectionOrchestration.ts`); canonical data is untouched until save.
5. `useProjection` and `useStochastic` share one query-state core in `src/hooks/useProjections.ts` over `BackendProjectionEngine`, which POSTs to `/v1/projections/deterministic` or streams `/v1/projections/stochastic` over SSE. The server cache plus TanStack Query cover repeat requests; there is no client-side projection cache.
6. `prepareSimulationRequest` resolves overrides, opening balances, dates, event policy, and optional `MonteCarloSample` into a prepared projection containing a `SimulationRequest`.
7. The pure `simulate` kernel returns an exact `SimulationRun`. `projectRawFinancialModelDocument` adapts it into a `ProjectionPath` and public result; `projectFinancialModelDocument` adds configured evaluations. The backend implements this pipeline; the TypeScript kernel remains the parity reference.
8. The persistent routed workspace exposes the loaded document and projection state to separate Results, Settings, and Model Inputs pages without restarting projection hooks during navigation.
9. The Analysis page derives observations from enabled one-time external-inflow postings and composes independent analyses without changing the financial model or projection lifecycle.

## 3. Persistence

The persistence boundary is the validated `FinancialModelDocument` aggregate. CSV represents an external snapshot of that aggregate through `accounts.csv`, `checkpoints.csv`, `postings.csv`, and one typed table per evaluation type under `configs/behavior/`. Checkpoints are absolute end-of-day observed account balances used to correct historical modeled state and reconcile it with posting-derived balances. Income definitions and tax profiles are separate source data and are never part of the persisted model document.

The HTTP repository is the only model persistence. There is no DAO, ingestion coordinator, or browser storage: `PUT /v1/financial-model` validates and stores the canonical document server-side.

### Backend

- Canonical routes: `GET/PUT /v1/financial-model`, `GET /v1/status`. There is no reset route; CSV files are seed-only. `PUT` is rejected with 403 when `NET_WORTH_ESTIMATOR_READ_ONLY=1` and requires a bearer token (`NET_WORTH_ESTIMATOR_AUTH_TOKEN`) when auth is configured.
- The SimpleFIN sync (`POST /v1/sync/simplefin`, same auth rules as `PUT`) writes only balance checkpoints and projection-disabled pending seed postings. Rows carry a `source` flag (`model` vs `simplefin`, V3 schema) exposed read-only on `GET`; saves strip forged sync rows and re-merge stored ones, with owner checkpoints winning key collisions. Projection/analysis POSTs additionally write best-effort cache rows to `projection_artifacts`; "owner-only writes" covers canonical model rows.
- The Go server (`backend/cmd/server`) imports canonical CSV data (`NET_WORTH_ESTIMATOR_MODEL_PATH`, default `public/configs`) and income data (`NET_WORTH_ESTIMATOR_INCOME_PATH`, default `public/data/income`) into `NET_WORTH_ESTIMATOR_DB` (SQLite).
- Income definitions are served through `/v1/income-data`. Posting analyses run client-side (`src/hooks/usePostingAnalyses.ts` over `src/lib/analysis/`); there is no server analyses endpoint.
- Projection endpoints: `POST /v1/projections/deterministic` (JSON) and `POST /v1/projections/stochastic` (SSE stream).
- `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` accepts a comma-separated runtime allowlist of exact HTTP/S browser origins. Requests carrying any other `Origin` are rejected; requests without `Origin` remain available to health checks, trusted proxies, and non-browser clients.

### Browser

The browser holds no model storage. Malformed canonical persisted data returns parse/validation diagnostics instead of falling back to bundled data. `VITE_API_BASE_URL` is normalized once and prefixes every HTTP and SSE backend route in separate-origin deployments.

### Projection Artifacts

- Derived projection artifacts are separate from the canonical `FinancialModelRepository` and live in the backend (`projection_artifacts` table, best-effort).
- The client keeps no projection cache: the server cache plus TanStack Query (`staleTime: Infinity`) cover repeat requests.
- Request identity is the `canonicalSerialize` string (sorted object keys, order-preserving arrays) from `projectionRequestIdentity`, used directly as the TanStack query key; it is not the server artifact cache key.
- Completed stochastic results are cached server-side by effective simulation inputs, normalized run count, seed intent, and evaluation configuration. A first unseeded cache miss materializes a concrete seed; later identical requests reuse that outcome.
- Progressive stochastic results are never persisted. A stochastic evaluation cache miss replays samples because individual sample paths are intentionally not retained.
- Hashing, validation, and artifact-store failures fail open: the backend still computes the requested projection.

### Simulation Kernel (Go Backend)

- The browser never simulates. All simulation lives in the Go backend (`backend/internal/domain/`: `prepare.go`, `transitions.go`, `simulate.go`, `path.go`, `project.go`, `stochastic.go`). There is no TypeScript simulation kernel; the former `lib/projection/reference/` parity reference has been deleted.
- Evaluation config validators (`src/lib/projection/evaluation/*`) stay client-side only where editors need instant field-level feedback (evaluation editors and result guards); they mirror backend rules and never gate persistence or projection. Result accessors are pure view selectors over backend-computed outcomes. Execution (kernel, branch simulation, evaluation runtime, stochastic orchestration) and authoritative validation run in the backend.

## 4. Core Types

- `FinancialModelDocument`: canonical persisted accounts, balance checkpoints, postings, typed evaluation tables, and source metadata.
- Editor draft (`workingDocument` + `editingBaseline` in `src/store.ts`): the session-only staged document. The effective projection input is `workingDocument ?? canonical document`; the frontend sends no `overrides` payload.
- `SimulationRequest`: resolved model, initial state, date range, start-date event policy, and optional `MonteCarloSample`.
- `SimulationRun`: exact initial/final states, dated balance snapshots, and ordered movement attempts from one kernel execution.
- `ProjectionPath`: immutable evaluator-facing timeline, effective document, and raw movement records containing requested amounts, realized amounts, and account deltas.
- `MonteCarloSample`: sampled annual rates by posting ID for one stochastic run.
- `ComparisonSnapshot`: read-only current/final net-worth and evaluation metrics captured by the UI. It contains no model document or overrides and cannot restore state.
- `EvaluationTables`: typed tables keyed by evaluation type. `EVALUATION_TYPE_ORDER` controls type order, and each table's array order preserves ingestion order.
- `EvaluationResultCollection`: locally ordered result tables keyed by evaluation type.

There is no named alternative-model domain or persistence API. Comparisons are metric snapshots only.

### Independent Transaction Evidence

- Posting observations are derived from enabled `once` postings with no source account and at least one destination. Recurring model rules are not treated as observed pay.
- Posting observations use the posting label/date/account and resolve numeric expressions when available; unresolved amounts remain source observations but cannot contribute to salary amounts.
- `AnalysisDefinition<TInput, TOutput>` is the common contract for independent enrichment, inference, map-data, and comparison computations. It is intentionally separate from projection `EvaluationDefinition`.
- Posting classification is an independent shared pass. Each analysis declares the classifier definitions it requires; orchestration combines those requirements into one plan, rejects conflicting definitions, and evaluates each selected classifier once per posting.
- The first composed pipeline consumes shared payer, payroll-language, and payment-rail classifications, detects recurring payroll evidence, and estimates observed net pay. Confirmed results can annualize; provisional results expose only per-deposit values when cadence history is weak. It does not read or mutate the modeled salary.

## 5. Model Semantics

### Accounts and Postings

- Accounts hold signed balances with generic minimum and maximum constraints.
- Postings select an exact amount resolver and bind its required inputs to literals or registered providers.
- Resolvers receive only validated config and concrete numeric inputs. Providers may read narrowly supplied balances, latest/YTD posting observations, the occurrence date, and the effective occurrence rate.
- The `income` resolver is an ordered payroll pipeline. It reads effective-dated annual gross income from the separate income data source, runs its `resolvers` array from left to right, and deposits the remaining post-tax amount into the posting destinations. Resolver steps may settle pre-tax contributions and employer match into their own destination accounts.
- Income definitions and tax profiles are source data, served by the backend from CSV under `public/data/income/`; they are not application configuration or part of the persisted financial-model document. Their normalized snapshot is passed through projection requests and cache identity.
- Posting frequency may be recurring or explicitly `once`; one-time rows execute exactly on their start date regardless of whether the end date is blank or equal to it.
- Blank `sourceAccountId` plus destinations is an external inflow.
- A source plus no destinations is an external outflow.
- A source plus destinations is an account-to-account transfer.
- Expression amounts preserve the arithmetic language and may apply annual growth and stochastic occurrence rates. Numeric resolvers reject those posting-level rate fields.
- Percentage, progressive-bracket, capped-percentage, and threshold-percentage are unrounded composable numeric primitives; the income pipeline composes percentage and progressive-bracket steps against the remaining annual amount.
- Source-funded rows clamp to available positive balance; `annualCap` is enforced per calendar year.
- Same-date rows execute by ascending priority, then file order.
- Historical postings and checkpoints are merged chronologically during request preparation. Same-date postings execute first, then checkpoints overwrite only their observed accounts as end-of-day truth. These corrections emit no cash-flow movements, but later postings and projection continue from the corrected state.
- During request preparation, enabled `once` postings dated strictly before the projection start are replayed through shared transitions in date, priority, then file order. Their balance snapshots form historical rows, while their dependency and annual-cap state carries into projection execution.
- A `once` posting on the projection start remains a normal projected event. Historical replay does not emit projected movement, cash-flow, or fulfillment events, and Monte Carlo samples do not resample already-realized history.

## 6. Engine Design

The deterministic kernel in `backend/internal/domain/simulate.go` receives only a prepared `SimulationRequest`. It does not receive overrides, evaluation configuration, or horizon settings. All simulation runs in the Go backend; there is no TypeScript simulation kernel.

- No name-based branching: IDs, labels, and categories do not select behavior.
- Classification is structural: source and destination presence determines inflow, outflow, or transfer behavior.
- `enabled` gates participation; `priority` only controls order.
- Account category is a UI concern.
- Shared transition functions apply growth, movement constraints, and posting execution consistently across deterministic, branch, and Monte Carlo runs.
- The kernel is pure and deterministic for the same request.

Canonical core APIs (Go backend, `backend/internal/domain/`) are:

| API | Role |
| --- | --- |
| `PrepareSimulationRequest` (`prepare.go`) | resolves the effective document, opening balances, dates, event policy, and optional `MonteCarloSample` into one prepared request |
| `ProjectRawFinancialModelDocument` (`path.go`) | runs the kernel and returns the evaluator-facing path plus public projection data |
| `ProjectFinancialModelDocument` (`project.go`) | adds deterministic configured evaluations |

On the client, the effective document is `workingDocument ?? canonical document` (`src/runtime/useProjectionOrchestration.ts`); there is no `applyModelOverrides` in the frontend.

### Behavior and Evaluation

- Read-only evaluations inspect an immutable `ProjectionPath`.
- Behaviors observe branch state and emit generic actions through the shared movement resolver.
- FI coverage uses canonical monthly candidate dates. Failed summary cycles stop at the first spending shortfall, and candidate scanning stops at the first successful cycle. Only the selected deterministic candidate is rerun with complete diagnostics and balance history.
- Branches replay only explicitly selected continuing postings. They never infer continuation from IDs, labels, categories, or rates.
- Candidate state includes all base-path events on the candidate date; branch processing starts strictly afterward.
- Branch state inherits latest realized posting amounts, current-year cap usage, and the run's sampled rates.
- Movement attempts record requested and realized amounts plus account deltas. Evaluations that need constraint diagnostics derive and own them from those generic facts and the effective model.
- Evaluator failures remain isolated in per-instance diagnostics.

## 7. Monte Carlo

Postings with `volatility > 0` enable Monte Carlo projection. A seedable linear congruential generator and log-normal sampling produce each `MonteCarloSample`.

The stochastic coordinator:

1. Calls `prepareSimulationRequest` once and reuses that prepared model, state, dates, and event structure for the deterministic baseline and every sampled run.
2. Executes path-only samples: each sample produces the `ProjectionPath` required by distribution and evaluation accumulators without building a redundant complete public result.
3. Uses the deterministic path's monthly FI candidate schedule for every run.
4. Records each run's first successful FI candidate and aggregates the cumulative probability that FI has been achieved by each candidate date.
5. Maintains exact sorted value distributions and computes P10/P25/P50/P75/P90 with exact percentile aggregation.
6. Processes runs in server-side batches and streams SSE `progress`/`partial` events; the client renders progressive `StochasticProjectionResult` updates.
7. Discards each sample path after the distribution and enabled evaluation trackers consume it.

8. Partial and final payloads carry percentile bands, milestones, and stochastic evaluations without re-embedding the deterministic timeline; the client reads deterministic state from its own query.

Percentile-band slope is never interpreted as a run outcome. FI confidence dates come from the cumulative distribution of each run's first successful candidate.

## 8. UI and State

- `/`: read-only current/projected metrics, charts, reconciliation, cash flow, debt, shortfalls, evaluation outcomes, and saved comparisons.
- `/settings`: session-only horizon, Monte Carlo, evaluation, and appearance configuration. Unapplied evaluation drafts block navigation; pending debounced Monte Carlo values flush when the page unmounts.
- `/model-inputs`: scheduled salary/checking transactions, paginated one-time transaction history, account-associated future rules, canonical editing, validation, temporary changes, templates, and source actions.
- `/analysis`: posting-derived payroll evidence and annualized observed net-pay inference.
- `App`: persistent data, mutation, deterministic projection, and stochastic projection controller shared by every route.
- `runtime/modelRuntime`: read-only model/repository state and wrapped actions; executable repository operations remain private to `App`.
- `runtime/projectionRuntime`: separate projection-artifact and execution-status providers so Monte Carlo progress does not rerender unrelated model consumers.
- `ProjectionDashboard`: current/projected metrics, account and contribution charts, reconciliation, cash flow, debt, shortfalls, and read-only evaluation outcomes.
- `EvaluationSettings`: evaluation collection management and type-specific configuration.
- `ModelInputsInspector`: presentation-grouped read views plus canonical account and posting editors. Posting grouping is UI-only and does not change model semantics.
- `ModelValidationPanel`: parsing and cross-reference diagnostics.
- `CurrentChangesControls`: session-only temporary additions and disable toggles.
- `CurrentChangesComparison`: captures and compares read-only `ComparisonSnapshot` metrics.
- `TemplateWizard`: generates common accounts and postings into the document editor.

`src/store.ts` composes `Editor`, `Settings`, and `Comparison` slices; theme lives in a separate `src/themeStore.ts` store. Current changes and projection settings are session-only. Baseline document edits persist only through the active `FinancialModelRepository`.

Route pages compose feature components. Feature components read user-owned state through Zustand selectors and hook-owned runtime state through the narrow runtime providers; presentational tables and charts continue to receive explicit props.

React Router uses browser paths. Production hosting must serve `index.html` for direct requests to application routes.

## 9. Key Files

| File | Role |
| --- | --- |
| `backend/internal/domain/prepare.go` | initial state and request preparation |
| `backend/internal/domain/transitions.go` | shared state transitions |
| `backend/internal/domain/simulate.go` | pure deterministic kernel |
| `backend/internal/domain/path.go` | run-to-path and public-result adaptation |
| `backend/internal/domain/project.go` | deterministic orchestration |
| `backend/internal/domain/stochastic.go` (+ `stochastic_session.go`) | prepared-request reuse, sample execution, exact percentiles, and progress batches |
| `backend/internal/domain/evaluation_runtime.go` | evaluation definition registration, configured evaluation lifecycle, and stochastic trackers |
| `backend/internal/domain/behavior.go` | generic reactive-behavior period loop |
| `src/lib/projection/evaluation/configValidation.ts` | single validation entry for evaluation configs |
| `src/engine/BackendProjectionEngine.ts` | HTTP/SSE client for backend deterministic and stochastic projection |
| `src/hooks/useProjections.ts` | deterministic + stochastic hooks over a shared query-state core |
| `src/hooks/useProjection.ts` | re-export of the deterministic hook (historical path kept for mocks) |
| `src/hooks/useStochastic.ts` | re-export of the stochastic hook (historical path kept for mocks) |
| `src/hooks/useFinancialModel.ts` | document query and save hooks |
| `src/lib/analysis/postingObservations.ts` | derives analysis observations from one-time external-inflow postings |
| `src/lib/analysis/classification.ts` | typed classifier definitions, requirement-plan composition, and shared classification pass |
| `src/lib/analysis/postingClassifiers.ts` | reusable payer, payroll-language, and payment-rail classifiers |
| `src/lib/analysis/` | independent analysis contract, runtime, and definitions |
| `src/hooks/usePostingAnalyses.ts` | typed posting-classification-to-payroll-to-salary analysis composition |
