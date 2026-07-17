# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a single-page React application that projects net worth and analyzes financial independence from a CSV-backed data model plus runtime projection settings. It supports both deterministic projections and Monte Carlo simulations with progressive streaming of results.

## 1. Tech Stack

- React 19, Vite, TypeScript
- Tailwind CSS v4
- Recharts
- Zustand (state management)
- TanStack Query (data fetching)
- Vitest
- Papa Parse
- Zod

## 2. High-Level Architecture & Data Flow

The application loads a scenario pack through a capability-based `DataSource` abstraction, validates it, and runs projections in dedicated Web Workers. Local development uses a Vite server plugin to read/write repo CSV files, while static/serverless production loads bundled `/scenario/*.csv` files and saves user edits in browser storage. Temporary what-if overrides and target-net-worth changes exist only in browser memory via Zustand for the current session.

### Data Flow Execution

1. `App.tsx` creates one `DataSource`: Vite dev uses `createCsvDataSource()` for `GET/PUT /api/scenario/pack`; production uses `createBrowserCsvDataSource()` to fetch `/scenario/*.csv` and persist edits in browser storage.
2. `src/hooks/useScenario.ts` wraps TanStack Query (`useScenarioQuery`, `useScenarioMutation`, `useScenarioResetMutation`) around the `DataSource` interface, which is created once in `App.tsx` via `useMemo` and passed via dependency injection.
3. Zod-based parsing plus cross-reference validation rejects invalid packs before projection.
4. What-if state (temporary postings, accounts, checkpoints, disable toggles) is stored in Zustand with immutable-style updates.
5. Deterministic projection runs in `src/workers/projectionWorker.ts` off the main thread.
6. Monte Carlo simulation runs in `src/workers/stochasticWorker.ts` — streaming partial results progressively to the UI.
7. A Dependency Injection pattern (`ProjectionEngineProvider` context) provides a `ProjectionEngine` instance to the React tree. `WorkerProjectionEngine` implements this interface, creating and destroying Web Workers per call.
8. The `useProjection` and `useStochastic` hooks consume this engine to trigger computation and manage loading/error state.
9. The inspector and dashboard render the validated pack and projected results.

## 3. Core Concepts

- `Account`: tracked signed balances with daily-compounded `annualRate`
- `Checkpoint`: historical truth for account balances on exact dates
- `Posting`: generic scheduled rules for future inflows, outflows, and transfers. Supports `volatility` for stochastic sampling.
- `ProjectionRuntimeSettings`: fallback start date, projection horizon, and a session-only financial-independence plan with explicit source selections

### Posting Semantics

- Blank `sourceAccountId` plus destination means external inflow.
- Source plus blank `destinationAccountId` means external outflow.
- Source plus destination means account-to-account transfer.
- `amountMode: fixed` uses the row's dollar amount.
- `amountMode: percent_of_base` uses a percentage of the latest realized amount from `basePostingId`.
- Rows with a source account clamp to that account's available positive balance.
- `annualCap` is generic and enforced per calendar year.
- Rows on the same date are applied by `priority`, then file order.

### Checkpoint Semantics

- Checkpoints are absolute balance snapshots, not adjustments. Each checkpoint row directly sets an account's balance to the given value — it does not add to or subtract from the current balance.
- Multiple checkpoints for different accounts on the same date are applied together to form a single historical row.
- Historical data exists only on exact checkpoint dates; there is no interpolation between checkpoints.

### Engine Design Philosophy

The projection engine in `src/lib/projection/engine/scenarioProject.ts` is intentionally clueless about the specific meaning of accounts and postings. It processes every account, checkpoint, and posting through the same generic pipeline — there are no special cases for particular IDs, categories, or labels:

- **No name-based branching**: The engine never inspects `account.id`, `account.category`, `posting.id`, or `posting.label` to choose different behavior. All accounts compound identically; all postings resolve the same way.
- **Classification is structural, not semantic**: Whether a posting is an inflow, outflow, or transfer is derived entirely from which of `sourceAccountId` / `destinationAccountId` is null — never from interpreting labels or categories.
- **The `enabled` flag is the only gate**: Disabled accounts are excluded from net worth; disabled postings are skipped. No other property controls engine behavior.
- **`priority` is just ordering**: The engine sorts by ascending priority; it does not interpret specific priority values.
- **Account `category` is a UI concern only**: The engine stores and passes through `category` but never inspects or branches on it.
- **Pure function**: The engine is a deterministic pure function — given the same pack, settings, and what-if state, it always produces identical results. No randomness, no side effects, no external API calls.

The boundary is at `CsvScenarioPack`: the CSV parsing and validation layer (`csvSchema.ts`, `csvValidation.ts`) handles domain-specific concerns (file names, column headers, cross-reference integrity). The engine receives validated, generic data and operates uniformly on it. The Zod schemas in `csvSchema.ts` are forward-compatible — they may validate CSV fields that are not yet wired into the engine types, and the engine simply ignores them.

**Avoid adding special-case logic to the engine unless absolutely unavoidable.** If a feature seems to require engine-level branching, first consider whether it can be expressed within the existing model — additional fields on existing types, new `amountMode` values, or UI-level interpretation of projection outputs. Likewise, the what-if system is intentionally shallow (multiplier overrides only, session-only, never mutating canonical data) to keep the model simple and predictable.

## 4. Monte Carlo / Stochastic Simulation

Postings can carry a `volatility` field (e.g., 0.15 for 15% annual volatility). When any enabled posting has `volatility > 0`, the app enables Monte Carlo mode.

### How It Works

1. The deterministic projection runs once to establish the baseline (expected) path.
2. The stochastic engine runs N independent scenarios (default 1000, adjustable 1–10000).
3. For each run, every volatile posting's `annualRate` is replaced by a log-normal sample drawn per projection year from `sampleLogNormal(expectedReturn, volatility)`.
4. All N projections produce per-date net worth snapshots. These are collapsed into percentile bands (P10/P25/P50/P75/P90) per date.
5. FI coverage and the complete evaluation cycle are evaluated inside each run. Run-level booleans are aggregated into FI-cycle probability and confidence-qualified dates; percentile-band slope is never treated as a run outcome.

### Seeding

The engine uses a Linear Congruential Generator with an optional seed for reproducible results. When `seed` is `null`, `Math.random()` is used.

### Streaming Progress

The main loop runs in batches of 100 projections. After each batch, the engine:

1. Calls `onProgress(progress, partialResult)` where `partialResult` is a full `StochasticProjectionResult` computed from accumulated runs so far.
2. The Web Worker forwards this via `postMessage` as a `StochasticWorkerProgress` message with the partial bands.
3. The `useWorkerProjection` hook merges the partial result into React state, updating both the progress bar and the chart bands progressively.
4. The chart's shaded percentile bands start wide (few runs, high variance) and converge toward final tight bands as iterations accumulate.

This is genuinely incremental — projection runs happen once, and percentile computation is a trivial O(k log k) sort on accumulated values per date.

### Key Files

| File                                             | Role                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/lib/projection/engine/financialIndependence.ts` | Derived analysis: annual coverage, virtual asset-pool withdrawals, and principal preservation |
| `src/lib/projection/engine/stochasticProject.ts` | Core engine: runs N projections, builds percentile bands, and aggregates per-run FI outcomes |
| `src/lib/projection/utils/stochastic.ts`         | LCG PRNG, `sampleLogNormal()` (Box-Muller), `computePercentiles()`                                    |
| `src/lib/projection/types/stochastic.ts`         | Types: `StochasticConfig`, `PercentileBands`, `StochasticBandRow`, `StochasticProjectionResult`       |
| `src/workers/stochasticWorker.ts`                | Web Worker: receives request, runs engine with progress callback, posts results                       |
| `src/workers/types.ts`                           | Message types: `StochasticWorkerRequest`, `StochasticWorkerProgress`, `StochasticWorkerResponse`      |
| `src/components/StochasticControls.tsx`          | UI: toggle, run count, seed input, progress bar, milestone stat cards                                 |
| `src/chart/chartData.ts`                         | Merges stochastic percentile bands into chart data rows for Recharts rendering                        |

## 5. UI Structure and Components

- `App.tsx`: creates the `DataSource` via DI, uses TanStack Query for scenario loading/mutation, orchestrates what-if overrides, deterministic projection, and stochastic simulation
- `ScenarioInspector` (in `CsvScenarioInspector.tsx`): shows read-only CSV-backed data tables plus validation issues; accepts scenario data as props
- `ContributionWhatIfControls` (in `CsvContributionWhatIfControls.tsx`): lets the user apply temporary overrides (add/remove/disable postings, accounts, checkpoints)
- `ProjectionDashboard` (in `CsvProjectionDashboard.tsx`): renders current and projected net worth, signed account balances, dated posting rows, and posting utilization
- `StochasticControls.tsx`: Monte Carlo toggle, run count, seed input, progress bar, and milestone stat cards (hit probability, P50/P10 hit dates, final P50)
- `TemplateWizard` (in `patterns/TemplateWizard.tsx`): Guides users through generating common financial patterns (like `IncomeForm`) and previews them before saving.
- `src/store.ts`: A Zustand store with 5 slices managing: `WhatIf` (temporary session overrides), `Editor` (CRUD for working copy), `Settings` (FI plan, horizon, stochastic configs), `Snapshot` (named scenario snapshots), and `Theme` (light/dark/system).

## 6. Technical Highlights

- Repo-backed local source: local development can edit plain CSV files in the repo through the Vite middleware.
- Serverless-safe browser source: production/static deployments load bundled CSV assets and save edits to browser storage instead of writing to the deployed filesystem.
- Capability-injected data source: `DataSource` decouples data access from the UI through optional actions like `save` and `reset`, so new backends do not require growing central mode conditionals.
- TanStack Query manages scenario data: `useScenarioQuery` (with `staleTime: Infinity`) and `useScenarioMutation` replace manual loading and stale-request tracking.
- Two Web Workers: deterministic projection and Monte Carlo simulation both run off the main thread.
- Progressive streaming: Monte Carlo results appear in the chart as they compute — wide bands narrow in real time toward final percentiles.
- Signed balance model: debt is represented with negative balances, so net worth is the sum of enabled accounts.
- Dated event engine: future projections run on exact checkpoint and scheduled posting dates with daily compounding between dates.
- Real-account cash model: future inflows, outflows, and transfers all post directly into tracked accounts.
- Generic engine: the projection engine treats all accounts and postings uniformly — no special-case logic by ID or category.
