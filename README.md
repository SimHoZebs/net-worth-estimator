# Net Worth Estimator

Single-page React app for inspecting and projecting net worth from a repo-backed CSV pack.

The current product model is intentionally simple:

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked signed account balances, dated contribution plans, dated transfers, and daily-compounded account growth between event dates.
- Debt is represented by negative account balances rather than a special liability type.
- Budget items create dated contribution-capacity cashflows only. They do not directly mutate tracked balances.
- Canonical data lives in `public/scenario/*.csv`.
- Runtime projection settings live in the app, not in CSV: target net worth is editable in-session, horizon is fixed at 50 years, and projection starts from the latest checkpoint date or today if none exist.
- The UI is read-only for persistent data and supports temporary session-only what-if overrides for contribution plans.

The current product-model summary and cleanup notes live in `REDESIGN_PLAN.md`.

## CSV Pack

The app expects these files under `public/scenario/`:

- `accounts.csv`
- `checkpoints.csv`
- `budget_items.csv`
- `contribution_plans.csv`
- `transfers.csv`

## Run

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run typecheck
npm run test:run
npm run build
```

## Current Architecture

- `src/App.tsx`: app shell that loads the CSV pack, applies session-only what-if state, and renders the inspector plus dashboard
- `src/hooks/useCsvScenarioPack.ts`: repo-backed CSV loading and refresh state
- `src/hooks/useCsvWhatIfState.ts`: temporary contribution override state
- `src/hooks/useCsvProjectionWorker.ts`: worker-backed projection execution
- `src/components/CsvScenarioInspector.tsx`: read-only CSV data inspection and validation display
- `src/components/CsvContributionWhatIfControls.tsx`: slider-based contribution what-if overrides
- `src/components/CsvProjectionDashboard.tsx`: net worth, capacity, and contribution projection dashboard
- `src/lib/projection/`: CSV schemas, validation, loading, projection logic, and shared types
- `src/lib/projection.csv.test.ts`: CSV loader and validation tests
- `src/lib/projection.csvProject.test.ts`: projection engine tests
