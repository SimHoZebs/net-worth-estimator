# Net Worth Estimator

Single-page React app for inspecting and projecting net worth from a repo-backed CSV pack.

The current product model is intentionally simple:

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked signed account balances, scheduled postings, and daily-compounded account growth between event dates.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- `amountMode` is `fixed` or `percent_of_base`, where base rows reference the latest realized amount of another posting.
- Annual caps are generic and source-funded rows clamp to the source account's available positive balance.
- The bundled starter data lives in `public/scenario/*.csv`.
- Runtime projection settings live in the app, not in CSV: the financial-independence plan, explicit income/asset source selections, and horizon are session-only. Projection starts from the latest checkpoint date or today if none exist.
- Financial independence is derived from annual expense coverage and a full principal-preservation cycle. Monte Carlo confidence is aggregated from complete run outcomes, never inferred from percentile-band slope.
- Baseline edits are persisted by the active data source, while what-if overrides remain session-only.

The current product-model summary lives in `REDESIGN_PLAN.md`.

## CSV Pack

The app expects these files under `public/scenario/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`

## Persistence Modes

- Local development (`npm run dev`) uses the Vite middleware at `/api/scenario/pack`; saving writes back to `public/scenario/*.csv` in your checkout.
- Static/serverless production, including Vercel, loads the bundled `/scenario/*.csv` files and saves baseline edits in the user's browser storage.
- Serverless deployments should not rely on writing files in the deployed app. Use a real backend data source if users need cross-device or shared persistence.
- Do not deploy private real financial CSV files publicly in `public/scenario/`; those files are served as static assets.

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

- `src/App.tsx`: app shell that chooses the active data source, applies session-only what-if state, and renders the inspector plus dashboard
- `src/hooks/useScenario.ts`: TanStack Query wrappers around the data source load/save/reset capabilities
- `src/store.ts`: temporary what-if state, scenario editor state, and runtime projection settings
- `src/engine/WorkerProjectionEngine.ts`: worker-backed projection execution
- `src/components/CsvScenarioInspector.tsx`: read-only CSV data inspection and validation display
- `src/components/CsvContributionWhatIfControls.tsx`: slider-based posting what-if overrides
- `src/components/CsvProjectionDashboard.tsx`: net worth and posting projection dashboard
- `src/lib/projection/`: CSV schemas, validation, loading, generic projection logic, FI analysis, and shared types
- `src/lib/projection.csv.test.ts`: CSV loader and validation tests
- `src/lib/projection.csvProject.test.ts`: projection engine tests
