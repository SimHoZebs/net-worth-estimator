# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a React application that loads a CSV-backed `FinancialModelDocument`, validates it, and projects net worth and financial-independence outcomes. Deterministic and Monte Carlo work runs in dedicated Web Workers.

## 1. Tech Stack

- React 19, Vite, and TypeScript
- Tailwind CSS v4 and uPlot
- Zustand and TanStack Query
- Papa Parse and Zod
- Vitest

## 2. Data Flow

1. `App.tsx` creates a capability-based `DataSource`. Development uses `createCsvDataSource()`; production uses `createBrowserCsvDataSource()`.
2. `useFinancialModelQuery` calls `DataSource.loadDocument()`, which returns `{ document, issues }`. Save and reset use `useFinancialModelMutation` and `useFinancialModelResetMutation`.
3. CSV parsing and cross-reference validation produce a `FinancialModelDocument` plus diagnostics. Invalid or malformed persisted data surfaces diagnostics instead of being silently discarded.
4. Zustand stores session-only `ModelOverrides`, displayed as current changes. `applyModelOverrides` creates the effective document without mutating canonical data.
5. `useProjection` and `useStochastic` pass the document, runtime settings, and overrides through a content-addressed `CachedProjectionEngine`. Cache misses delegate to `WorkerProjectionEngine` and dedicated workers.
6. `prepareSimulationRequest` resolves overrides, checkpoint history, initial state, dates, event policy, and optional `MonteCarloSample` into a prepared projection containing a `SimulationRequest`.
7. The pure `simulate` kernel returns an exact `SimulationRun`. `projectRawFinancialModelDocument` adapts it into a `ProjectionPath` and public result; `projectFinancialModelDocument` adds configured evaluations.
8. The persistent routed workspace exposes the loaded document and projection state to separate Results, Settings, and Model Inputs pages without restarting worker hooks during navigation.

## 3. Persistence

The persistence boundary is the validated `FinancialModelDocument` represented by `accounts.csv`, `checkpoints.csv`, `postings.csv`, and one typed CSV table per evaluation type under `configs/behavior/`.

### Development

- Canonical route: `GET/PUT /api/financial-model`
- Saves write the same CSV files under `public/configs/`.

### Browser

- Canonical key: `net-worth-estimator:financial-model:v1`
- Malformed canonical persisted data returns parse/validation diagnostics instead of falling back to bundled data.
- Reset removes the canonical key and reloads bundled `/configs/` files.

### Projection Artifacts

- Derived projection artifacts are separate from the canonical `DataSource` and use the backend-agnostic `ProjectionArtifactStore` contract.
- The browser implementation stores immutable artifacts in IndexedDB under `net-worth-estimator:projection-artifacts` and prunes the oldest entries beyond its configured bound.
- Canonical semantic descriptors are serialized with sorted object keys and order-preserving arrays, then addressed by SHA-256. Artifact envelopes carry independent schema and algorithm versions.
- Deterministic base paths and evaluation results are stored separately. Evaluation-only changes reuse the base simulation, while label-only changes relabel cached results without computation.
- Completed stochastic results are cached by effective simulation inputs, normalized run count, seed intent, and evaluation configuration. A first unseeded cache miss materializes a concrete seed; later identical requests reuse that persisted outcome.
- Progressive stochastic results are never persisted. A stochastic evaluation cache miss replays samples because individual sample paths are intentionally not retained.
- IndexedDB, hashing, validation, and quota failures fail open: workers still compute the requested projection.

## 4. Core Types

- `FinancialModelDocument`: canonical persisted accounts, postings, checkpoints, typed evaluation tables, and source metadata.
- `ModelOverrides`: session-only additions and disabled account/posting selections applied before preparation.
- `SimulationRequest`: resolved model, initial state, date range, start-date event policy, and optional `MonteCarloSample`.
- `SimulationRun`: exact initial/final states, dated balance snapshots, and ordered movement attempts from one kernel execution.
- `ProjectionPath`: immutable evaluator-facing timeline, effective document, and movement records.
- `MonteCarloSample`: sampled annual rates by posting ID for one stochastic run.
- `ComparisonSnapshot`: read-only current/final net-worth and evaluation metrics captured by the UI. It contains no model document or overrides and cannot restore state.
- `EvaluationTables`: typed tables keyed by evaluation type. `EVALUATION_TYPE_ORDER` controls type order, and each table's array order preserves ingestion order.
- `EvaluationResultCollection`: locally ordered result tables keyed by evaluation type.

There is no named alternative-model domain or persistence API. Comparisons are metric snapshots only.

## 5. Model Semantics

### Accounts and Postings

- Accounts hold signed balances with generic minimum and maximum constraints.
- Postings carry annual rates and growth assumptions used by scheduled and Monte Carlo execution.
- Blank `sourceAccountId` plus destinations is an external inflow.
- A source plus no destinations is an external outflow.
- A source plus destinations is an account-to-account transfer.
- `amountMode: fixed` uses the row amount.
- `amountMode: percent_of_base` uses a percentage of the latest realized amount from `basePostingId`.
- Source-funded rows clamp to available positive balance; `annualCap` is enforced per calendar year.
- Same-date rows execute by ascending priority, then file order.

### Checkpoints

- A checkpoint is an absolute account balance observation, not an adjustment.
- Checkpoints for different accounts on the same date form one historical row.
- Historical values exist only on checkpoint dates; no interpolation occurs.
- Projection starts from the latest checkpoint or the runtime fallback date when no checkpoint exists.

## 6. Engine Design

The deterministic kernel in `simulation/simulate.ts` receives only a prepared `SimulationRequest`. It does not receive checkpoints, overrides, evaluation configuration, or horizon settings.

- No name-based branching: IDs, labels, and categories do not select behavior.
- Classification is structural: source and destination presence determines inflow, outflow, or transfer behavior.
- `enabled` gates participation; `priority` only controls order.
- Account category is a UI concern.
- Shared transition functions apply growth, movement constraints, and posting execution consistently across deterministic, branch, and Monte Carlo runs.
- The kernel is pure and deterministic for the same request.

Canonical core APIs are:

| API | Role |
| --- | --- |
| `applyModelOverrides` | builds an effective document from canonical data and session-only current changes |
| `prepareSimulationRequest` | resolves persistence/runtime concerns into one prepared request |
| `projectRawFinancialModelDocument` | runs the kernel and returns the evaluator-facing path plus public projection data |
| `projectFinancialModelDocument` | adds deterministic configured evaluations |

### Behavior and Evaluation

- Read-only evaluations inspect an immutable `ProjectionPath`.
- Behaviors observe branch state and emit generic actions through the shared movement resolver.
- FI coverage uses canonical monthly candidate dates. Eligible candidates fork balances and evaluate a complete principal-preservation cycle.
- Branches replay only explicitly selected continuing postings. They never infer continuation from IDs, labels, categories, or rates.
- Candidate state includes all base-path events on the candidate date; branch processing starts strictly afterward.
- Branch state inherits latest realized posting amounts, current-year cap usage, and the run's sampled rates.
- Movement attempts record requested and realized amounts plus binding constraints. Posting-fulfillment evaluation derives business diagnostics from those generic facts.
- Evaluator failures remain isolated in per-instance diagnostics.

## 7. Monte Carlo

Postings with `volatility > 0` enable Monte Carlo projection. A seedable linear congruential generator and log-normal sampling produce each `MonteCarloSample`.

The stochastic coordinator:

1. Calls `prepareSimulationRequest` once and reuses that prepared model, state, dates, and event structure for the deterministic baseline and every sampled run.
2. Executes path-only samples: each sample produces the `ProjectionPath` required by distribution and evaluation accumulators without building a redundant complete public result.
3. Uses the deterministic path's monthly FI candidate schedule for every run.
4. Aggregates complete per-run outcomes for evaluation probabilities.
5. Maintains exact sorted value distributions and computes P10/P25/P50/P75/P90 with exact percentile aggregation.
6. Processes runs in worker batches of 50 and emits progressive `StochasticProjectionResult` updates.
7. Discards each sample path after the distribution and enabled evaluation trackers consume it.

Percentile-band slope is never interpreted as a run outcome. FI-cycle probability and confidence-qualified dates come from complete candidate outcomes.

## 8. UI and State

- `/`: read-only current/projected metrics, charts, reconciliation, cash flow, debt, shortfalls, evaluation outcomes, and saved comparisons.
- `/settings`: session-only horizon, Monte Carlo, evaluation, and appearance configuration. Unapplied evaluation drafts block navigation; pending debounced Monte Carlo values flush when the page unmounts.
- `/model-inputs`: read-only and editable model tables, validation, temporary changes, templates, and source actions.
- `App`: persistent data, mutation, deterministic projection, and stochastic projection controller shared by every route.
- `runtime/modelRuntime`: read-only model/source state and wrapped source actions; executable `DataSource` operations remain private to `App`.
- `runtime/projectionRuntime`: separate projection-artifact and execution-status providers so Monte Carlo progress does not rerender unrelated model consumers.
- `ProjectionDashboard`: current/projected metrics, account and contribution charts, reconciliation, cash flow, debt, shortfalls, and read-only evaluation outcomes.
- `EvaluationSettings`: evaluation collection management and type-specific configuration.
- `ModelInputsInspector`: read-only and editable model tables.
- `ModelValidationPanel`: parsing and cross-reference diagnostics.
- `CurrentChangesControls`: session-only temporary additions and disable toggles.
- `CurrentChangesComparison`: captures and compares read-only `ComparisonSnapshot` metrics.
- `TemplateWizard`: generates common accounts and postings into the document editor.

`src/store.ts` composes `ModelOverrides`, editor, settings, comparison, and theme slices. Current changes and projection settings are session-only. Baseline document edits persist only through the active `DataSource`.

Route pages compose feature components. Feature components read user-owned state through Zustand selectors and hook-owned runtime state through the narrow runtime providers; presentational tables and charts continue to receive explicit props.

React Router uses browser paths. Production hosting must serve `index.html` for direct requests to application routes.

## 9. Key Files

| File | Role |
| --- | --- |
| `src/lib/projection/model/applyModelOverrides.ts` | effective-document construction |
| `src/lib/projection/simulation/prepareSimulation.ts` | checkpoint and request preparation |
| `src/lib/projection/simulation/transitions.ts` | shared state transitions |
| `src/lib/projection/simulation/simulate.ts` | pure deterministic kernel |
| `src/lib/projection/simulation/projectPath.ts` | run-to-path and public-result adaptation |
| `src/lib/projection/analysis/projectFinancialModel.ts` | deterministic orchestration |
| `src/lib/projection/analysis/projectStochastic.ts` | prepared-request reuse, sample execution, exact percentiles, and progress batches |
| `src/lib/projection/evaluation/runtime.ts` | configured evaluation lifecycle and stochastic trackers |
| `src/lib/projection/evaluation/registry.ts` | evaluation definition registration |
| `src/workers/projectionWorker.ts` | deterministic worker entry point |
| `src/workers/stochasticWorker.ts` | stochastic worker and progress streaming |
| `src/hooks/useFinancialModel.ts` | document query, save, and reset hooks |
| `src/hooks/useProjection.ts` | deterministic worker hook |
| `src/hooks/useStochastic.ts` | stochastic worker hook |
