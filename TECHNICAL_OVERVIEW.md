# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a React application that loads a CSV-backed `FinancialModelDocument`, validates it, and projects net worth and financial-independence outcomes. Deterministic and Monte Carlo work runs in dedicated Web Workers.

## 1. Tech Stack

- React 19, Vite, and TypeScript
- Tailwind CSS v4 and uPlot
- Zustand and TanStack Query
- Papa Parse and Zod
- Vitest

## 2. Data Flow

1. `App.tsx` creates a capability-based `FinancialModelRepository`. Development uses the Vite CSV API repository; production uses the browser repository.
2. Model Inputs and query hooks depend only on `FinancialModelRepository`. In production, a bundled CSV ingestion source and browser storage DAO connect behind that boundary through `FinancialModelIngestionCoordinator`.
3. CSV parsing and cross-reference validation produce a `FinancialModelDocument` plus diagnostics. Invalid or malformed persisted data surfaces diagnostics instead of being silently discarded.
4. Zustand stores session-only `ModelOverrides`, displayed as current changes. `applyModelOverrides` creates the effective document without mutating canonical data.
5. `useProjection` and `useStochastic` pass the document, runtime settings, and overrides through a content-addressed `CachedProjectionEngine`. Cache misses delegate to `WorkerProjectionEngine` and dedicated workers.
6. `prepareSimulationRequest` resolves overrides, opening balances, dates, event policy, and optional `MonteCarloSample` into a prepared projection containing a `SimulationRequest`.
7. The pure `simulate` kernel returns an exact `SimulationRun`. `projectRawFinancialModelDocument` adapts it into a `ProjectionPath` and public result; `projectFinancialModelDocument` adds configured evaluations.
8. The persistent routed workspace exposes the loaded document and projection state to separate Results, Settings, and Model Inputs pages without restarting worker hooks during navigation.
9. The Analysis page derives observations from enabled one-time external-inflow postings and composes independent analyses without changing the financial model or projection lifecycle.

## 3. Persistence

The persistence boundary is the validated `FinancialModelDocument` aggregate. CSV represents an external snapshot of that aggregate through `accounts.csv`, `checkpoints.csv`, `postings.csv`, and one typed table per evaluation type under `configs/behavior/`. Checkpoints are absolute end-of-day observed account balances used to correct historical modeled state and reconcile it with posting-derived balances. Income definitions and tax profiles are separate source data and are never part of the persisted model document.

`FinancialModelIngestionCoordinator` connects a read-only `FinancialModelIngestionSource` to `FinancialModelDao`. Source revisions hash canonical model content without `sourcePath`; object keys are sorted and domain-significant array order is preserved. The coordinator conditionally replaces only the exact source-owned DAO version it observed. It has no storage lifecycle, schema, clear, or delete capability. User saves mark records as user-owned and therefore stop automatic source replacement.

### Development

- Canonical route: `GET/PUT /api/financial-model`
- Saves write the configured model CSV files. The Vite API defaults to the tracked public files and supports alternate source directories through `NET_WORTH_ESTIMATOR_MODEL_PATH` and `NET_WORTH_ESTIMATOR_INCOME_PATH`.
- Income CSV files are read through `/api/income-data/*` in development and bundled `/data/income/` files in production.

### Browser

- Canonical key: `net-worth-estimator:financial-model`
- Malformed canonical persisted data returns parse/validation diagnostics instead of falling back to bundled data.
- Reset is a repository lifecycle action: it clears browser persistence, then asks ingestion to persist a fresh source-owned snapshot from bundled `/configs/` files.
- Persisted records atomically contain the model, an opaque version, and user/source provenance. Conditional replacement prevents a delayed source synchronization from overwriting a concurrent user save.
- Browser writes and conditional replacements use a cross-context Web Lock. If writable storage or Web Locks are unavailable, the browser repository exposes bundled CSV as read-only.

### Projection Artifacts

- Derived projection artifacts are separate from the canonical `FinancialModelRepository` and use the backend-agnostic `ProjectionArtifactStore` contract.
- The browser implementation stores immutable artifacts in memory for the current application session.
- Canonical semantic descriptors are serialized with sorted object keys and order-preserving arrays, then addressed by SHA-256.
- Deterministic base paths and evaluation results are stored separately. Evaluation-only changes reuse the base simulation, while label-only changes relabel cached results without computation.
- Completed stochastic results are cached by effective simulation inputs, normalized run count, seed intent, and evaluation configuration. A first unseeded cache miss materializes a concrete seed; later identical requests reuse that persisted outcome.
- Progressive stochastic results are never persisted. A stochastic evaluation cache miss replays samples because individual sample paths are intentionally not retained.
- Hashing, validation, and artifact-store failures fail open: workers still compute the requested projection.

## 4. Core Types

- `FinancialModelDocument`: canonical persisted accounts, balance checkpoints, postings, typed evaluation tables, and source metadata.
- `ModelOverrides`: session-only additions and disabled account/posting selections applied before preparation.
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
- Income definitions and tax profiles are source data, currently loaded from CSV under `public/data/income/`; they are not application configuration or part of the persisted financial-model document. Their normalized snapshot is passed through projection, workers, and cache identity.
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

The deterministic kernel in `simulation/simulate.ts` receives only a prepared `SimulationRequest`. It does not receive overrides, evaluation configuration, or horizon settings.

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
6. Processes runs in worker batches of 50 and emits progressive `StochasticProjectionResult` updates.
7. Discards each sample path after the distribution and enabled evaluation trackers consume it.

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

`src/store.ts` composes `ModelOverrides`, editor, settings, comparison, and theme slices. Current changes and projection settings are session-only. Baseline document edits persist only through the active `FinancialModelRepository`.

Route pages compose feature components. Feature components read user-owned state through Zustand selectors and hook-owned runtime state through the narrow runtime providers; presentational tables and charts continue to receive explicit props.

React Router uses browser paths. Production hosting must serve `index.html` for direct requests to application routes.

## 9. Key Files

| File | Role |
| --- | --- |
| `src/lib/projection/model/applyModelOverrides.ts` | effective-document construction |
| `src/lib/projection/simulation/prepareSimulation.ts` | initial state and request preparation |
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
| `src/lib/analysis/postingObservations.ts` | derives analysis observations from one-time external-inflow postings |
| `src/lib/analysis/classification.ts` | typed classifier definitions, requirement-plan composition, and shared classification pass |
| `src/lib/analysis/postingClassifiers.ts` | reusable payer, payroll-language, and payment-rail classifiers |
| `src/lib/analysis/` | independent analysis contract, runtime, and definitions |
| `src/hooks/usePostingAnalyses.ts` | typed posting-classification-to-payroll-to-salary analysis composition |
