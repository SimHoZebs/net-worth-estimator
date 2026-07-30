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
| `useFinancialModelQuery` | `hooks/useFinancialModel.ts` | loads `{ document, issues }` from `DataSource.loadDocument`; `staleTime: Infinity` |
| `useFinancialModelMutation` | `hooks/useFinancialModel.ts` | saves a `FinancialModelDocument` and invalidates the model query |
| `useFinancialModelResetMutation` | `hooks/useFinancialModel.ts` | resets the source and replaces query data |
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
2. **Persistence DI**: `App.tsx` creates `createCsvDataSource()` in development or `createBrowserCsvDataSource()` in production. `DataSource.loadDocument()` returns `{ document, issues }`.
3. **Query layer**: `useFinancialModelQuery`, `useFinancialModelMutation`, and `useFinancialModelResetMutation` connect the source to TanStack Query.
4. **Current changes**: `ModelOverrides` remain in Zustand and are applied with `applyModelOverrides`; canonical data is not mutated.
5. **Projection**: `useProjection`/`useStochastic` -> `CachedProjectionEngine` -> `WorkerProjectionEngine` on misses -> Web Workers -> `prepareSimulationRequest` -> `simulate` -> `ProjectionPath` -> evaluation/analysis aggregation.
6. **Monte Carlo**: one prepared request is reused, each `MonteCarloSample` produces a path-only run, exact percentiles are aggregated, and progress is emitted in worker batches of 50.
7. **Browser persistence**: `net-worth-estimator:financial-model` is the only browser key. Malformed or noncanonical data surfaces diagnostics; reset removes that key and reloads bundled CSV data.
8. **Derived artifacts**: `ProjectionArtifactStore` is separate from `DataSource`; browser artifacts are content-addressed, session-only, and disposable.

## Key Types

| Type | Purpose |
| --- | --- |
| `FinancialModelDocument` | canonical persisted accounts, postings, evaluations, and source metadata |
| `ModelOverrides` | session-only additions and disabled account/posting IDs |
| `SimulationRequest` | fully prepared model, runtime state, date range, event policy, and optional sample |
| `SimulationRun` | exact states, dated balance snapshots, and ordered movement attempts |
| `ProjectionPath` | immutable evaluator-facing time series and movement events |
| `MonteCarloSample` | sampled annual posting rates for one run |
| `ComparisonSnapshot` | read-only captured metrics for UI comparison |
| `ProjectionResult` | deterministic public result and evaluation result tables |
| `StochasticProjectionResult` | deterministic result, exact percentile bands, and stochastic evaluation aggregation |
| `DataSource` | `loadDocument` plus optional labeled `save` and `reset` capabilities |
| `FinancialModelParseResult` | `{ document, issues }` |

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
- Enabled `once` postings before the projection start establish historical balances through shared transitions. Start-date rows remain projected events; historical replay carries dependency/cap state but emits no projected movements or evaluation events.
- Run `npm run test:run` and `npm run typecheck` after code changes.
