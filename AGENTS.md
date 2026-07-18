# AGENTS.md — Net Worth Estimator

## Quick start

- `npm run dev` — start Vite dev server
- `npm run test` — run vitest

## Architecture

Read `TECHNICAL_OVERVIEW.md` for system-level details (tech stack, engine design philosophy, Monte Carlo). This doc covers agent-specific context: component structure, hooks, store, and rules.

---

## Component Map

```
main.tsx → <QueryClientProvider> → <ProjectionEngineProvider> → <App>

App (src/App.tsx)
├── <ProjectionDashboard> (src/components/CsvProjectionDashboard.tsx, 190 lines)
│   ├── <OverviewCard>, <OutcomeMetric>, <CompactDetail>, <DriverCard>
│   ├── <FinancialIndependenceChart>
│   ├── <AccountDiagnosticChart> (recharts: ComposedChart)
│   ├── <TransactionCompletionTable>, <UpcomingTransactionsTable>
│   └── <ContributionWhatIfControls> (children slot)
├── <StochasticControls> — toggle, run count, seed, progress, milestone cards
├── <ScenarioInspector> — packs + tables + validation (read-only & editing modes)
│   ├── <ScenarioValidationPanel>
│   ├── <ReadOnlyAccountsTable|EditableAccountsTable>
│   ├── <ReadOnlyPostingsTable|EditablePostingsTable>
│   └── <ReadOnlyCheckpointsTable|EditableCheckpointsTable>
└── <TemplateWizard> — <IncomeForm> → <TemplatePreview> → store
```

### Dashboard sub-components (`src/components/dashboard/`)

| Directory            | Contents                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard/`         | OverviewCard, OutcomeMetric, CompactDetail, DriverCard, FinancialIndependenceChart, NetWorthReconciliation, AccountLinesChart, CashFlowWaterfall, DebtSummary, ShortfallCalendar, ShortfallDetailPanel, StackedContributionChart, StochasticResultCard |
| `dashboard/tables/`  | TransactionCompletionTable, EditableAccountsTable, EditablePostingsTable, EditableCheckpointsTable, ReadOnlyAccountsTable, ReadOnlyPostingsTable, ReadOnlyCheckpointsTable                                                                                     |
| `dashboard/what-if/` | WhatIfAccountForm, WhatIfPostingForm, WhatIfCheckpointForm                                                                                                                                                                                                     |
| `dashboard/charts/`  | AccountDiagnosticChart, AccountLinesChart, ColorSwatch, StackedContributionChart                                                                                                                                                                               |

### UI primitives (`src/components/ui/`)

Alert, button, card, collapsible-section, table — pure presentational.

---

## Hook Layer

| Hook                           | File                                    | Signature                                                                                          |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `useProjection`                | `hooks/useProjection.ts` (62 lines)     | `(pack, settings, whatIfState, enabled) → ProjectionHookState<ProjectionResult>`                   |
| `useStochastic`                | `hooks/useStochastic.ts` (78 lines)     | `(pack, settings, whatIfState, config, enabled) → ProjectionHookState<StochasticProjectionResult>` |
| `useScenarioQuery`             | `hooks/useScenario.ts`                  | `(DataSource) → UseQueryResult` (TanStack Query, staleTime: Infinity)                              |
| `useScenarioMutation`          | `hooks/useScenario.ts`                  | `(DataSource) → UseMutationResult` (invalidates query on success)                                  |
| `useDebouncedStochasticConfig` | `hooks/useDebouncedStochasticConfig.ts` | Debounced StochasticConfig for StochasticControls                                                  |

Shared: `ProjectionHookState<T>` (`hooks/types.ts`) — `{ result, runtimeError, isRunning, progress }`

---

## Store (`src/store.ts`) — zustand, 5 slices

| Slice        | Purpose                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| **WhatIf**   | Temporary overrides (add/remove/toggle accounts, postings, checkpoints; reset)         |
| **Editor**   | CRUD on working copy (start/cancel editing, isDirty/isEditing, update/delete/add rows) |
| **Settings** | ordered configured evaluations, horizonYears, stochasticPreference, stochasticConfig  |
| **Snapshot** | Named scenario snapshots (label, timestamp, whatIfState, metrics)                      |
| **Theme**    | light/dark/system theme with DOM application                                           |

Selectors: `selectActiveOverrideCount`, `selectWhatIfState`, `selectEditorState`, `selectEditorActions`

---

## Pattern / Template System (`src/lib/patterns/`)

- `generateIncomePattern(input, existingAccountIds, existingPostingIds)` — generates accounts (checking, 401k, brokerage) + postings (salary, 401k, taxes, match, auto-invest)
- Used by `TemplateWizard` → `IncomeForm` → `TemplatePreview` → store

---

## Data Flow (condensed — see TECHNICAL_OVERVIEW.md §2, §4)

1. **CSV Pipeline**: Vite plugin (`plugins/csvFilePlugin.ts`) → `GET/PUT /api/scenario/pack` → `csvLoader.ts` (Papa Parse + Zod via `csvSchema.ts`) → cross-validation (`csvValidation.ts`)
2. **DI**: `App.tsx` creates `DataSource` (`createCsvDataSource` for dev, `createBrowserCsvDataSource` for production) → passed to hooks via TanStack Query
3. **Projections**: `useProjection`/`useStochastic` hooks → `WorkerProjectionEngine` → Web Workers (`src/workers/`) → `scenario/prepareScenario.ts` → `simulation/projectPath.ts` → `evaluation/` / `analysis/` aggregation
4. **What-if**: Zustand session-only overrides (never mutates canonical data)
5. **Chart data**: `buildAccountDiagnosticChartData(pack, result, stochasticResult?)` in `src/chart/chartData.ts`

---

## Engine Layer — DI Pattern

- `ProjectionEngineProvider` (context) wraps app with a `ProjectionEngine` instance
- `WorkerProjectionEngine` implements `ProjectionEngine` — creates/destroys Workers per call
- Workers: `projectionWorker.ts` (deterministic), `stochasticWorker.ts` (streaming progress in batches of 50)

---

## Key Types

| Type                         | Location                             | Purpose                                                   |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `ScenarioPack`               | `lib/projection/types/scenario.ts`   | accounts + postings + checkpoints                         |
| `ProjectionResult`           | same                                 | Projection output plus ordered generic evaluation envelopes |
| `StochasticProjectionResult` | `lib/projection/types/stochastic.ts` | Monte Carlo bands plus ordered generic evaluation envelopes |
| `ScenarioWhatIfState`        | `lib/projection/types/scenario.ts`   | Temporary overrides (added + disabled ID arrays)          |
| `ProjectionRuntimeSettings`  | same                                 | evaluations, fallbackProjectionStartDate, horizonYears |
| `ProjectionHookState<T>`     | `hooks/types.ts`                     | `{ result, runtimeError, isRunning, progress }`           |
| `DataSource`                 | `lib/projection/dataSource.ts`       | `{ loadPack, savePack, sourceType }`                      |
| `ScenarioParseResult`        | same                                 | `{ pack, issues }`                                        |

---

## Rules

- Simulation logic (`lib/projection/simulation/`) must never branch on specific account IDs, posting IDs, or categories. See `TECHNICAL_OVERVIEW.md` §3.
- FI logic is a derived analysis in `evaluation/financialIndependence.ts`; it must not add semantic branches to generic simulation.
- Reactive behaviors emit generic account movements and must use shared account constraints instead of mutating balances directly.
- FI continuing postings are explicitly selected; never infer growth from IDs, labels, categories, or a non-zero annual rate.
- Evaluation definitions register in `evaluation/registry.ts`; central deterministic/stochastic coordinators must not import evaluator-specific logic.
- Evaluation configuration and results remain ordered and keyed by stable instance IDs. Duplicate definition IDs are invalid; duplicate configured definitions are valid.
- Configured evaluation configs and public result bodies must remain JSON-serializable; registries, functions, maps, and accumulators stay internal to the worker runtime.
- React evaluation editors/renderers live outside the projection domain and consume generic envelopes through typed accessors.
- What-if state is session-only, never mutates canonical data.
- Use `@/lib/projection` barrel import for all projection types and utilities.
- Projection and stochastic computation happen in Web Workers (`src/workers/`), never on main thread.
- New components go in `src/components/` (or `src/components/dashboard/` if sub-components). UI primitives in `src/components/ui/`.
- Run `npm run test:run` and `npm run typecheck` after changes.
