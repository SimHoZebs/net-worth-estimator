# AGENTS.md - Net Worth Estimator

## Quick Start

- `npm run dev` - start the Vite dev server
- `npm run test:run` - run Vitest once
- `npm run typecheck` - run TypeScript checks

Read `TECHNICAL_OVERVIEW.md` for system-level details.

## Component Map

```text
main.tsx -> providers -> <RouterProvider> -> <App>

App (src/App.tsx)
`-- runtime providers -> <AppShell> -> <Outlet>
    |-- / -> <ResultsPage> -> dashboard, evaluation results, comparisons
    |-- /analysis -> posting-derived evidence and analyses
    |-- /settings -> simulation, Monte Carlo, evaluation, and theme settings
    `-- /model-inputs -> inspector, current changes, templates, and source status
```

### Dashboard Sub-components

| Directory | Contents |
| --- | --- |
| `src/components/dashboard/` | overview cards, metrics, reconciliation, cash flow, debt, shortfall, FI, account, contribution, and stochastic views |
| `src/components/dashboard/tables/` | scheduled transactions, transaction history, account rules, and canonical editors |
| `src/components/dashboard/current-changes/` | temporary account and posting forms |
| `src/components/dashboard/charts/` | diagnostic, account, contribution, and point-detail chart components |
| `src/components/ui/` | presentational primitives |

## Hook Layer

| Hook | File | Contract |
| --- | --- | --- |
| `useFinancialModelQuery` | `hooks/useFinancialModel.ts` | loads `{ document, issues }` from `FinancialModelRepository.loadDocument`; `staleTime: Infinity` |
| `useFinancialModelMutation` | `hooks/useFinancialModel.ts` | saves a `FinancialModelDocument` and invalidates the model query |
| `useFinancialModelResetMutation` | `hooks/useFinancialModel.ts` | resets the source and replaces query data |
| `usePostingAnalyses` | `hooks/usePostingAnalyses.ts` | derives observations from model postings and composes classification, payroll detection, and salary estimation analyses |
| `useProjection` | `hooks/useProjection.ts` | `(document, settings, overrides, enabled) -> ProjectionHookState<ProjectionResult>` |
| `useStochastic` | `hooks/useStochastic.ts` | `(document, settings, overrides, config, enabled) -> ProjectionHookState<StochasticProjectionResult>` |
| `useDebouncedStochasticConfig` | `hooks/useDebouncedStochasticConfig.ts` | debounces Monte Carlo configuration |

`ProjectionHookState<T>` is `{ result, runtimeError, isRunning, progress }`.

`App.tsx` owns projection hooks above the route outlet. Do not move them into individual pages; route navigation must not abort or restart unchanged computations.

Route pages should compose feature components rather than forward shared-state prop bundles. Feature components select user-owned state directly from Zustand and consume hook-owned model/projection state from `src/runtime/`. Keep explicit props for presentational component boundaries.

## Store

`src/store.ts` composes five Zustand slices:

| Slice | Purpose |
| --- | --- |
| `ModelOverrides` | session-only current changes: added rows, disabled IDs, and reset |
| `Editor` | CRUD on a working `FinancialModelDocument` and edit/dirty state |
| `Settings` | typed evaluation tables, horizon, stochastic preference, and stochastic config |
| `Comparison` | read-only `ComparisonSnapshot` metrics; snapshots cannot restore model state |
| `Theme` | light/dark/system theme and DOM application |

Primary selectors are `selectCurrentChangeCount`, `selectModelOverrides`, `selectEditorState`, and `selectEditorActions`.

## Data Flow

1. **CSV source**: Vite plugin -> `GET/PUT /api/financial-model` -> `csvLoader.ts` -> Zod parsing and cross-validation. Documents contain only canonical fields.
2. **Persistence DI**: `App.tsx` creates `createCsvApiFinancialModelRepository()` in development or `createBrowserFinancialModelRepository()` in production. Model Inputs use only the repository; browser CSV ingestion and browser storage are connected behind it.
3. **Query layer**: `useFinancialModelQuery`, `useFinancialModelMutation`, and `useFinancialModelResetMutation` connect the source to TanStack Query.
4. **Current changes**: `ModelOverrides` remain in Zustand and are applied with `applyModelOverrides`; canonical data is not mutated.
5. **Projection**: `useProjection`/`useStochastic` -> `CachedProjectionEngine` -> `WorkerProjectionEngine` on misses -> Web Workers -> `prepareSimulationRequest` -> `simulate` -> `ProjectionPath` -> evaluation/analysis aggregation.
6. **Monte Carlo**: one prepared request is reused, each `MonteCarloSample` produces a path-only run, exact percentiles are aggregated, and progress is emitted in worker batches of 50.
7. **Browser persistence**: `net-worth-estimator:financial-model` stores the financial model. Malformed or noncanonical data surfaces diagnostics; reset removes that key and reloads bundled CSV data. Analyses use the canonical model postings and add no separate transaction key.
8. **Derived artifacts**: `ProjectionArtifactStore` is separate from `FinancialModelRepository`; browser artifacts are content-addressed, session-only, and disposable.
9. **Independent analyses**: `AnalysisDefinition` computations run as explicit pipelines over posting-derived observations. Active analyses contribute classifier requirements to one shared posting-classification plan before payroll detection and salary estimation; the pipeline does not participate in projection or mutate the financial model.

## Key Types

| Type | Purpose |
| --- | --- |
| `FinancialModelDocument` | canonical persisted accounts, checkpoints, postings, evaluations, and source metadata |
| `Checkpoint` | absolute end-of-day observed balance that corrects historical modeled account state |
| `ModelOverrides` | session-only additions and disabled account/posting IDs |
| `SimulationRequest` | fully prepared model, runtime state, date range, event policy, and optional sample |
| `SimulationRun` | exact states, dated balance snapshots, and ordered movement attempts |
| `ProjectionPath` | immutable evaluator-facing time series and movement events |
| `MonteCarloSample` | sampled annual posting rates for one run |
| `ComparisonSnapshot` | read-only captured metrics for UI comparison |
| `ProjectionResult` | deterministic public result and evaluation result tables |
| `StochasticProjectionResult` | deterministic result, exact percentile bands, and stochastic evaluation aggregation |
| `FinancialModelRepository` | application-facing model reads plus optional labeled save and reset capabilities |
| `FinancialModelIngestionSource` | read-only external snapshot and semantic revision used by ingestion |
| `FinancialModelDao` | implementation-neutral persisted-record reads and conditional replacement; no lifecycle methods |
| `FinancialModelParseResult` | `{ document, issues }` |
| `PostingObservationDataset` | observations derived from enabled one-time external-inflow postings |
| `AnalysisDefinition` | typed independent computation from an input value to a diagnosed output |

## Rules

- Simulation logic must never branch on specific account IDs, posting IDs, labels, or categories.
- `projectFinancialModelDocument`, `projectRawFinancialModelDocument`, `applyModelOverrides`, and `prepareSimulationRequest` are the canonical core APIs.
- Shared state transitions belong in `lib/projection/simulation/transitions.ts`; deterministic, branch, and Monte Carlo execution must not duplicate transition semantics.
- FI logic is a derived evaluation and must not add semantic branches to generic simulation.
- Reactive behaviors emit generic account movements through shared account constraints instead of mutating balances directly.
- FI continuing postings are explicitly selected; never infer them from IDs, labels, categories, or non-zero rates.
- Evaluation definitions register in `evaluation/registry.ts`; central coordinators must not import evaluator-specific logic.
- Evaluation configuration and results remain grouped by type. `EVALUATION_TYPE_ORDER` controls type order, table arrays preserve ingestion order, and instances retain stable globally unique IDs. Configs and public bodies must remain JSON-serializable.
- `ModelOverrides` are session-only and never mutate canonical data.
- Comparison snapshots contain metrics only; do not add restoration or alternative-model semantics.
- Keep the domain canonical-only: no named alternative models, compatibility APIs, alternate readers, or additional persistence routes.
- Use the `@/lib/projection` barrel for projection types and utilities.
- Deterministic and stochastic computation runs in Web Workers, never on the main thread.
- Historical preparation merges postings and checkpoints chronologically. Same-date postings execute first, checkpoints then overwrite observed accounts, and later postings continue from that corrected state. Checkpoints emit no movement or cash-flow events.
- Enabled `once` postings before the projection start establish historical balances through shared transitions. Start-date rows remain projected events; historical replay carries dependency/cap state but emits no projected movements or evaluation events.
- Run `npm run test:run` and `npm run typecheck` after code changes.
