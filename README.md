# Net Worth Estimator

Single-page React app for inspecting and projecting net worth from a repo-backed CSV pack.

The current product model is intentionally simple:

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked signed account balances, scheduled postings, and daily-compounded account growth between event dates.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- `amountMode` is `fixed` or `percent_of_base`, where base rows reference the latest realized amount of another posting.
- Annual caps are generic and source-funded rows clamp to the source account's available positive balance.
- Canonical data lives in `public/scenario/*.csv`.
- Runtime projection settings live in the app, not in CSV: target net worth is editable in-session, horizon is fixed at 50 years, and projection starts from the latest checkpoint date or today if none exist.
- The UI is read-only for persistent data and supports temporary session-only what-if multipliers for scheduled postings.

The current product-model summary lives in `REDESIGN_PLAN.md`.

## CSV Pack

The app expects these files under `public/scenario/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`

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
- `src/hooks/useCsvWhatIfState.ts`: temporary posting override state
- `src/hooks/useCsvProjectionWorker.ts`: worker-backed projection execution
- `src/components/CsvScenarioInspector.tsx`: read-only CSV data inspection and validation display
- `src/components/CsvContributionWhatIfControls.tsx`: slider-based posting what-if overrides
- `src/components/CsvProjectionDashboard.tsx`: net worth and posting projection dashboard
- `src/lib/projection/`: CSV schemas, validation, loading, projection logic, and shared types
- `src/lib/projection.csv.test.ts`: CSV loader and validation tests
- `src/lib/projection.csvProject.test.ts`: projection engine tests
