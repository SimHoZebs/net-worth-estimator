# Net Worth Estimator

Single-page React app for inspecting and projecting net worth from a repo-backed CSV pack.

The current product model is intentionally simple:

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked signed account balances, scheduled postings, and daily-compounded account growth between event dates.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- `amountMode` is `fixed` or `percent_of_base`, where base rows reference the latest realized amount of another posting.
- Annual caps are generic and source-funded rows clamp to the source account's available positive balance.
- The bundled starter data lives in `public/configs/`.
- Evaluation and behavior-simulation settings load from one CSV per behavior under `public/configs/behavior/`; edits made in the app remain session-only. The projection horizon is also session-only. Projection starts from the latest checkpoint date or today if none exist.
- Financial independence is derived from annual expense coverage and a full principal-preservation cycle. A configurable minimum-net-worth rule gates cycle eligibility, while explicit continuing postings and shared account constraints drive reactive withdrawals. Monte Carlo confidence is aggregated from complete run outcomes, never inferred from percentile-band slope.
- Baseline edits are persisted by the active data source, while what-if overrides remain session-only.

The current product-model summary lives in `REDESIGN_PLAN.md`.

## CSV Pack

The app expects these files under `public/configs/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`
- `behavior/financial-independence.csv`
- `behavior/net-worth-threshold.csv`
- `behavior/posting-fulfillment.csv`

Each behavior file has the columns `order`, `instanceId`, `label`, `enabled`, and `config`. The behavior definition is inferred from the filename, `order` preserves global evaluation order across files, and `config` is JSON encoded as a CSV value. Both `order` and `instanceId` must be unique across behavior files, while multiple rows in one file configure multiple instances of that behavior.

`financial-independence.csv` configures the branch behavior simulation, including source selections, continuing postings, withdrawal policy, and confidence. `net-worth-threshold.csv` and `posting-fulfillment.csv` configure read-only path evaluations. New definitions receive their own file rather than adding rows to a shared evaluation file.

## Persistence Modes

- Local development (`npm run dev`) uses the Vite middleware at `/api/scenario/pack`; saving writes back to `public/configs/` in your checkout.
- Static/serverless production, including Vercel, loads the bundled `/configs/` files and saves baseline edits in the user's browser storage.
- Serverless deployments should not rely on writing files in the deployed app. Use a real backend data source if users need cross-device or shared persistence.
- Do not deploy private real financial CSV files publicly in `public/configs/`; those files are served as static assets.

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
- `src/lib/projection/scenario/`: effective-scenario preparation
- `src/lib/projection/simulation/`: generic account, posting, arithmetic, and path simulation
- `src/lib/projection/evaluation/`: read-only and path-dependent financial evaluations
- `src/lib/projection/behavior/`: reactive behavior runtime
- `src/lib/projection/analysis/`: deterministic and stochastic orchestration
- `src/lib/projection.csv.test.ts`: CSV loader and validation tests
- `src/lib/projection.csvProject.test.ts`: projection engine tests
