# AGENTS.md — Net Worth Estimator

## Quick start
- `npm run dev` — start Vite dev server
- `npm run test` — run vitest

## Architecture
Read `TECHNICAL_OVERVIEW.md` for system-level details. This doc focuses on component-level structure, responsibility boundaries, and composition patterns.

---

## Component Map

### Entry: `main.tsx` → `App.tsx`
- `main.tsx`: Sets up `QueryClientProvider`, `ProjectionEngineProvider`, mounts `<App/>`.
- `App.tsx` (231 lines): Orchestration root. Creates `DataSource`, runs projection hooks (`useProjection`, `useStochastic`), wires what-if state, and composes all top-level sections.

### Top-level sections rendered by `App.tsx`:

```
App
├── <ProjectionDashboard>        # Main chart + metrics + driver cards + transaction tables
│   └── <ContributionWhatIfControls>   # Passed via children slot
├── <StochasticControls>         # Monte Carlo toggle, run count, seed, progress, results
├── <ScenarioInspector>          # Data tables, validation, editing
└── <TemplateWizard>             # Income pattern modal
```

---

## Current Problems: Large Components

### 1. `CsvProjectionDashboard.tsx` (472 lines)
**Problem:** Single monolithic component that computes ~15 derived values inline and renders 8 distinct UI sections. Difficult to test, read, or modify any one section in isolation.

**Sections to extract (composition pattern):**

| Section | Proposed Component | Props |
|---------|-------------------|-------|
| Headline + badge | `ProjectionHeadline` | `goalReached`, `headline`, `headlineDetail`, `activeOverrideCount`, `statusBadgeClassName` |
| Target input card | `TargetNetWorthCard` | `targetNetWorthInput`, `onChange`, `horizonYears`, `projectionStartDate`, `activeOverrideCount` |
| Outcome metrics grid | `OutcomeMetricsRow` | `currentNetWorth`, `latestHistoricalDate`, `finalNetWorth`, `finalDate`, `distanceToTarget`, `goalReached` |
| Key assumptions panel | `AssumptionsPanel` | `pack`, `projectionSettings`, `hasStochasticData` |
| Driver cards row | `DriverCardsRow` | `blockerValue`, `blockerDetail`, `firstProjectedRow`, `nextEventDetail`, `postingUtilizationRate`, `requestedPostingAmount`, `realizedPostingAmount`, `enabledPostingCount`, `goalReached` |
| Transaction completion table | `TransactionCompletionTable` | `postingSummaries` |
| Upcoming transactions table (with expand/collapse) | `UpcomingTransactionsTable` | `activeFutureRows`, `postingLabelById`, `expandedEventRows`, `onToggleEventRow` |

### 2. `CsvScenarioInspector.tsx` (457 lines)
**Problem:** Doubles JSX size by branching on `isEditing` for accounts, postings, and checkpoints. Each has a read-only render path and an inline-editable render path within the same component.

**Sections to extract:**

| Section | Proposed Component |
|---------|-------------------|
| Editable accounts table | `EditableAccountsTable` |
| Read-only accounts table | `ReadOnlyAccountsTable` (thin wrapper around `DataTable`) |
| Editable postings table | `EditablePostingsTable` |
| Read-only postings table | `ReadOnlyPostingsTable` (thin wrapper) |
| Editable checkpoints table | `EditableCheckpointsTable` |
| Read-only checkpoints table | `ReadOnlyCheckpointsTable` (thin wrapper) |

Private helpers (`DataTable`, `SummaryCard`) are defined inline in the file — extract to their own files once they have multiple consumers.

### 3. `CsvContributionWhatIfControls.tsx` (420 lines)
**Problem:** Three form-in-a-section patterns (account, posting, checkpoint) are duplicated inline. Each has: label header, "Add" button, inline form with many fields, and item list.

**Sections to extract:**

| Section | Proposed Component |
|---------|-------------------|
| What-if add/edit account form with list | `WhatIfAccountForm` |
| What-if add/edit posting form with list | `WhatIfPostingForm` |
| What-if add/edit checkpoint form with list | `WhatIfCheckpointForm` |

### 4. `StochasticControls.tsx` (236 lines) — minor
**Problem:** Debounce timer logic (`debounceRef`, `scheduleConfigChange`, `applyImmediately`) is embedded in the component body. Should be a hook.

**Extract:** `useDebouncedStochasticConfig` hook.

### 5. `App.tsx` (231 lines) — minor
**Problem:** `activeOverrideCount` is computed manually at lines 40-47 but `selectActiveOverrideCount` already exists in the store. Use the existing selector. Same issue in `CsvProjectionDashboard.tsx` lines 75-82.

---

## Components Already Following SRP

These are fine, no extraction needed:
- `AccountDiagnosticChart.tsx` — pure chart rendering
- `OutcomeMetric.tsx` — pure label/value/detail display
- `CompactDetail.tsx` — pure label/value pair
- `DriverCard.tsx` — pure card with tone
- `ScenarioValidationPanel.tsx` — pure validation issue display
- `ui/*` (alert, button, card, collapsible-section, table) — pure presentational
- `TemplateWizard.tsx` — orchestrated internal composition (IncomeForm + TemplatePreview)
- `TemplatePreview.tsx` — pure display
- `IncomeForm.tsx` — pure form

---

## Data Flow: Full Pipeline

### 1. CSV Data Source (strategy pattern)

```
Vite plugin (plugins/csvFilePlugin.ts)
  └─ GET /api/scenario/pack  → reads CSV files from public/scenario/
  └─ PUT /api/scenario/pack  → writes CSV files back to disk
       │
       
       ▼
DataSource interface (lib/projection/dataSource.ts)
  ├─ loadPack(): Promise<ScenarioParseResult>
  └─ savePack(pack): Promise<ScenarioParseResult>
       │
       
       ▼
createCsvDataSource() (sources/csv/csvDataSource.ts, 38 lines)
  └─ Thin HTTP client calling /api/scenario/pack, created via DI in App.tsx
       │
       
       ▼
Vite plugin → csvLoader.ts (192 lines)
  ├─ fetchCsvScenarioFiles() — fetches 3 CSV files via fetch
  ├─ parseCsvScenarioPack() — Papa Parse + Zod per row
  │    ├─ csvSchema.ts — Zod schemas: csvAccountSchema, csvPostingSchema, csvCheckpointSchema
  │    └─ csvValidation.ts (286 lines) — cross-collection validation:
  │         ├─ Unique IDs (accounts, postings)
  │         ├─ ID collision detection (account vs posting)
  │         ├─ Foreign key integrity (source/destination accounts exist)
  │         ├─ Checkpoint account existence
  │         ├─ Arithmetic validation (parse errors, unknown identifiers, self-references, circular deps)
  │         ├─ Posting constraint checks (empty accounts, source=dest, date range)
  │         └─ Account balance bounds (minBalance ≤ maxBalance)
  └─ serializeCsvScenarioPack() — serializes pack back to CSV strings
```

### 2. Projection Engine (Web Workers)

```
App.tsx creates hooks:
  ├─ useProjection(pack, settings, whatIfState, enabled) → ProjectionHookState<ProjectionResult>
  └─ useStochastic(pack, settings, whatIfState, config, enabled) → ProjectionHookState<StochasticProjectionResult>
       │
       
       ▼
useProjectionEngine() — React context (DI pattern)
  └─ ProjectionEngineProvider wraps app tree with a ProjectionEngine instance
       │
       
       ▼
WorkerProjectionEngine (engine/WorkerProjectionEngine.ts, 145 lines)
  ├─ project() — creates Worker → projectionWorker.ts → projectScenarioPack() → result
  └─ projectStochastic() — creates Worker → stochasticWorker.ts → stochasticProject() → streaming progress + result
       │
       
       ▼
Workers (src/workers/)
  ├─ projectionWorker.ts (23 lines) — calls projectScenarioPack(), posts result
  ├─ stochasticWorker.ts (41 lines) — calls stochasticProject() with progress → posts progress + result
  └─ types.ts (42 lines) — message contracts:
       ├─ ProjectionWorkerRequest/Response
       ├─ StochasticWorkerRequest/Progress/Response
       └─ type discriminator: "progress" vs "result"
```

### 3. Core Projection Engine (lib/projection/engine/)

```
scenarioProject.ts → projectScenarioPack()
  ├─ accountEngine.ts — initAccountBalances, snapshotBalances, computeNetWorth, getWithdrawableAmount, getHeadroom
  ├─ postingEngine.ts — generate dated occurrences, compute requested amounts, resolve against constraints
  │    ├─ arithmetic.ts — custom expression parser (hand-coded lexer + recursive descent)
  │    │    Supports: +, -, *, /, abs(), rate keyword, posting IDs (reference realized amounts),
  │    │              account IDs (reference balances), unary minus, parens
  │    └─ utils/date.ts — parseIsoDate, formatIsoDate, daysBetween, addMonthsClamped, addYearsClamped
  └─ Produces: ProjectionResult (timeline rows, account summaries, posting summaries, totals, milestones)

stochasticProject.ts → stochasticProject()
  ├─ Runs N independent projections with log-normal sampled rates for volatile postings
  ├─ Streams progress in batches (onProgress callback every 100 runs)
  └─ Produces: StochasticProjectionResult (percentile bands, hit probability, median/worst-case dates)
       └─ utils/stochastic.ts — LCG PRNG, sampleLogNormal (Box-Muller), computePercentiles
```

---

## Hook Layer

| Hook | File | Signature | Behavior |
|------|------|-----------|----------|
| `useScenarioQuery` | `hooks/useScenario.ts` | `(DataSource) → UseQueryResult` | TanStack Query, `staleTime: Infinity`, key: `["scenario"]` |
| `useScenarioMutation` | `hooks/useScenario.ts` | `(DataSource) → UseMutationResult` | Saves pack via `dataSource.savePack()`, invalidates query cache on success |
| `useProjection` | `hooks/useProjection.ts` (62 lines) | `(pack, settings, whatIfState, enabled) → ProjectionHookState<ProjectionResult>` | Calls `engine.project()`. Aborts previous run on dependency change via `AbortController`. Lifecycle: useEffect with cleanup. |
| `useStochastic` | `hooks/useStochastic.ts` (78 lines) | `(pack, settings, whatIfState, config, enabled) → ProjectionHookState<StochasticProjectionResult>` | Calls `engine.projectStochastic()` with progress callback that streams partial results into state. Aborts on change. |

Shared type: `ProjectionHookState<T>` (`hooks/types.ts`) — `{ result: T | null, runtimeError: string | null, isRunning: boolean, progress: number | null }`

---

## Engine Layer (DI)

### ProjectionEngineContext (`src/engine/ProjectionEngineContext.tsx`, 28 lines)
React context + provider + hook. Provides a `ProjectionEngine` instance via DI:
- `ProjectionEngineProvider` — wraps app with `engine` instance
- `useProjectionEngine()` — throws if used outside provider

### ProjectionEngine interface (`lib/projection/engine/ProjectionEngine.ts`, 31 lines)
```typescript
interface ProjectionEngine {
  project(request: ProjectionRequest): Promise<ProjectionResult>;
  projectStochastic(request: StochasticRequest, onProgress?: ProgressCallback): Promise<StochasticProjectionResult>;
}
```
`ProjectionRequest` extends `{ pack, projectionSettings, whatIfState, signal? }`.
`StochasticRequest` adds `config: StochasticConfig`.
`ProgressCallback`: `(progress: number, partial?: StochasticProjectionResult) => void`

### WorkerProjectionEngine (`src/engine/WorkerProjectionEngine.ts`, 145 lines)
Implements `ProjectionEngine`. Creates/destroys Workers per call:
- **project()**: Creates `projectionWorker.ts`, posts request, listens for single response, terminates worker. Handles `AbortSignal` (terminate on abort).
- **projectStochastic()**: Creates `stochasticWorker.ts`, posts request, listens for both `"progress"` messages (forwards to `onProgress`) and a final `"result"` message. Terminates on abort.

---

## Worker Message Types

| Type | Direction | Fields |
|------|-----------|--------|
| `ProjectionWorkerRequest` | main → worker | `id, pack, projectionSettings, whatIfState` |
| `ProjectionWorkerResponse` | worker → main | `id, result, runtimeError` |
| `StochasticWorkerRequest` | main → worker | `id, pack, projectionSettings, whatIfState, config` |
| `StochasticWorkerProgress` | worker → main | `id, progress, type: "progress", partial?` |
| `StochasticWorkerResponse` | worker → main | `id, result, runtimeError, type: "result"` |

Defined in `src/workers/types.ts` (42 lines).

---

## Chart Data Module (`src/chart/chartData.ts`, 114 lines)

| Function | Input | Output |
|----------|-------|--------|
| `buildBalanceChartData` | `pack, result` | `Record[]` — date + per-account balances |
| `buildAccountDiagnosticChartData` | `pack, result, stochasticResult?` | `Record[]` — date, netWorth, per-account balances, stochastic bands (p10_base, outerThickness, p25_base, innerThickness, p50, _p10/_p90/_p25/_p75, _hasStochastic) |
| `buildStochasticChartData` | `result, stochasticResult` | `StochasticChartRow[]` |

The `AccountDiagnosticChart` component reads these chart rows. When stochastic data is present, the chart uses stacked `Area` components for bands and a `Line` for P50; otherwise a single `Line` for net worth.

---

## Pattern / Template System (`src/lib/patterns/`)

| File | Export | Purpose |
|------|--------|---------|
| `types.ts` | `IncomeTemplateInput`, `TemplateOutput`, `TemplateGenerationResult` | Types for income pattern generation |
| `income.ts` (178 lines) | `generateIncomePattern(input, existingAccountIds, existingPostingIds)` | Generates accounts (checking, k401, brokerage) and postings (salary, 401k employee, taxes, employer match, auto-invest) from a single form input. Handles unique ID generation and arithmetic expressions referencing other postings. |
| `index.ts` | Barrel | Re-exports all patterns |

Used by `TemplateWizard` → `IncomeForm` (input) → `TemplatePreview` (preview) → applies to store.

---

## Formatting (`src/lib/format.ts`, 55 lines)

| Export | Type | Description |
|--------|------|-------------|
| `currency` | `Intl.NumberFormat` | USD, no decimal |
| `pct` | `Intl.NumberFormat` | Percent, 1 decimal |
| `integer` | `Intl.NumberFormat` | No decimals |
| `decimal` | `Intl.NumberFormat` | 4 decimals |
| `formatChartCurrencyTick` | function | `$1.2M`, `$500k`, `$0` |
| `formatDate` | function | ISO → "May 3, 2026" |
| `formatTooltipCurrency` | function | Number coercion + currency format |
| `pluralize` | function | `3 errors`, `1 error` |
| `formatRoute` | function | `"Source -> Dest1 ; Dest2"` |

---

## Store (`store.ts`)

Three clean slices via zustand:
1. **WhatIfSlice** — temporary overrides (add/remove/toggle accounts, postings, checkpoints; reset)
2. **EditorSlice** — CRUD on a working copy of the scenario pack (start/cancel editing, update/delete/add rows, `isDirty`/`isEditing`)
3. **SettingsSlice** — target net worth input, stochastic toggle + config

Prefer using `selectActiveOverrideCount` and `selectWhatIfState` selectors rather than computing these inline (currently duplicated in `App.tsx` and `CsvProjectionDashboard.tsx`).

---

## Key Types (reference)

| Type | Location | Purpose |
|------|----------|---------|
| `Account` | `lib/projection/types/scenario.ts` | Financial account (id, label, balance bounds, color, enabled) |
| `Posting` | `lib/projection/types/scenario.ts` | Scheduled transaction (arithmetic, frequency, rates, volatility, caps, priority) |
| `Checkpoint` | `lib/projection/types/scenario.ts` | Historical balance snapshot (Date, AccountId, Balance) |
| `ScenarioPack` | `lib/projection/types/scenario.ts` | accounts + postings + checkpoints + version + sourcePath |
| `ScenarioWhatIfState` | `lib/projection/types/scenario.ts` | Temporary overrides (added arrays + disabled ID arrays) |
| `ProjectionResult` | `lib/projection/types/scenario.ts` | Deterministic projection output (timeline, summaries, totals, milestones) |
| `StochasticConfig` | `lib/projection/types/stochastic.ts` | `{ runCount: number, seed: number | null }` |
| `StochasticProjectionResult` | `lib/projection/types/stochastic.ts` | Monte Carlo output (bands, hit probability, percentile milestones) |
| `PercentileBands` | `lib/projection/types/stochastic.ts` | Per-date P10/P25/P50/P75/P90 net worth |
| `ProjectionRuntimeSettings` | `lib/projection/types/scenario.ts` | targetNetWorth, fallbackProjectionStartDate, horizonYears |
| `ProjectionHookState<T>` | `hooks/types.ts` | `{ result, runtimeError, isRunning, progress }` |
| `DataSource` | `lib/projection/dataSource.ts` | `{ loadPack, savePack, sourceType }` |
| `ScenarioParseResult` | `lib/projection/dataSource.ts` | `{ pack, issues }` |
| `ProjectionEngine` | `lib/projection/engine/ProjectionEngine.ts` | `{ project, projectStochastic }` |
| `ScenarioValidationIssue` | `lib/projection/types/validation.ts` | `{ severity, code, message, path }` |
| `AppStore` | `store.ts` | Combined zustand store (WhatIf + Editor + Settings) |
| `IncomeTemplateInput` | `lib/patterns/types.ts` | Income pattern form data |
| `TemplateOutput` | `lib/patterns/types.ts` | Generated `{ accounts, postings, checkpoints }` |

---

## Full Dependency Graph

```
main.tsx
  ├─ @tanstack/react-query (QueryClient)
  ├─ ProjectionEngineProvider
  │    └─ WorkerProjectionEngine (implements ProjectionEngine)
  │         ├─ projectionWorker.ts → projectScenarioPack()
  │         └─ stochasticWorker.ts → stochasticProject()
  └─ App
       ├─ useScenarioQuery(dataSource) ── .loadPack() → CSV pipeline
       ├─ useScenarioMutation(dataSource) ── .savePack() → CSV pipeline
       ├─ useProjection(pack, settings, whatIfState, enabled)
       │    └─ useProjectionEngine() → engine.project()
       ├─ useStochastic(pack, settings, whatIfState, config, enabled)
       │    └─ useProjectionEngine() → engine.projectStochastic()
       ├─ useStore (whatIf, settings, editing)
       ├─ <ProjectionDashboard>
       │    ├─ <AccountDiagnosticChart> (recharts: ComposedChart, Area, Line, ReferenceLine, Tooltip)
       │    ├─ <OutcomeMetric> × 3
       │    ├─ <CompactDetail>
       │    ├─ <DriverCard> × 3
       │    ├─ buildAccountDiagnosticChartData(pack, result, stochasticResult)
       │    └─ <ContributionWhatIfControls> (children slot)
       ├─ <StochasticControls>
       │    └─ store (stochasticEnabled, stochasticConfig)
       ├─ <ScenarioInspector>
       │    ├─ <ScenarioValidationPanel>
       │    ├─ <SummaryCard> × 7
       │    ├─ <DataTable> × 3 (read-only tables)
       │    └─ inline editable tables (editing mode)
       └─ <TemplateWizard>
            ├─ <IncomeForm> → generateIncomePattern()
            └─ <TemplatePreview>

Lib core:
  projection/engine/scenarioProject.ts
   ├─ accountEngine.ts
   ├─ postingEngine.ts → arithmetic.ts, utils/date.ts
   └─ utils/date.ts
  projection/engine/stochasticProject.ts
   ├─ scenarioProject.ts
   └─ utils/stochastic.ts (LCG, Box-Muller, percentiles)

Store: zustand with 3 slices (WhatIf, Editor, Settings)

CSV pipeline:
  createCsvDataSource() → /api/scenario/pack
   └─ Vite plugin
        └─ csvLoader.ts → Papa Parse + csvSchema.ts (Zod) + csvValidation.ts
```

---

## Rules
- Engine logic (`lib/projection/engine/`) must never branch on specific account IDs, posting IDs, or categories. See `TECHNICAL_OVERVIEW.md` §3 for the full design philosophy.
- What-if state is session-only, never mutates canonical data.
- Use `@/lib/projection` barrel import for all projection types and utilities.
- Projection and stochastic computation happen in Web Workers (`src/workers/`), never on main thread.
- When adding new components, place them in `src/components/` (or `src/components/dashboard/` if they are dashboard sub-components). Presentational UI primitives go in `src/components/ui/`.
- Run `npm run test` after changes to verify nothing broke. Use `npm run lint` if available.
