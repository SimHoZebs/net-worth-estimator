# Net Worth Estimator

React app for inspecting a CSV-backed financial model and projecting net worth with deterministic and Monte Carlo simulation.

The product model is intentionally generic:

- Projection-start balances are derived by replaying enabled one-time postings dated before the projection start; net worth then evolves through scheduled postings and daily-compounded growth between event dates.
- Balance checkpoints are absolute end-of-day account observations. Historical postings are replayed chronologically, checkpoints correct the modeled balances on their dates, and later postings continue from the corrected state.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- Posting frequencies include explicit one-time (`once`) transactions.
- Postings use explicit amount resolvers with validated inputs; the optional `income` resolver runs an ordered payroll pipeline from separate effective-dated income data.
- Annual caps are generic, and source-funded rows clamp to the source account's available positive balance.
- Financial independence is derived from annual expense coverage and a full principal-preservation cycle. Explicit continuing postings and shared account constraints drive reactive withdrawals.
- Monte Carlo confidence is aggregated from complete run outcomes, never inferred from percentile-band slope.
- Baseline edits are persisted by the active `FinancialModelRepository`. `ModelOverrides`, shown as current changes, are session-only and never mutate the canonical document.
- `ComparisonSnapshot` records read-only metrics for comparison. It does not store or restore an alternative model.

## CSV Files

The app reads these CSV files under `public/configs/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`
- `behavior/financial-independence.csv`
- `behavior/net-worth-threshold.csv`
- `behavior/posting-fulfillment.csv`

The bundled `public/` files provide the default model and income data. During development, `NET_WORTH_ESTIMATOR_MODEL_PATH` and `NET_WORTH_ESTIMATOR_INCOME_PATH` can point the Vite API at alternate source directories.

Each behavior file is a typed table. All tables start with `instanceId`, `label`, and `enabled`, followed by definition-specific columns. Financial independence stores its scalar plan fields directly and uses JSON only for `sources` and `continuingPostingIds`; net-worth threshold adds `target`; posting fulfillment adds `postingIds`. Evaluation types follow the global `EVALUATION_TYPE_ORDER`, while rows within a type retain their physical CSV ingestion order. `instanceId` must be unique across behavior files, and one file may contain multiple instances.

`financial-independence.csv` configures branch simulation, including source selections, continuing postings, withdrawal policy, and confidence. `net-worth-threshold.csv` and `posting-fulfillment.csv` configure read-only path evaluations.

Income source definitions and tax profiles are loaded from `public/data/income/` and are served through `/api/income-data/` during local development.

## Persistence

- Local development (`npm run dev`) uses `GET/PUT /api/financial-model` and `/api/income-data/*`; alternate source directories are opt-in through environment variables and the tracked public files are the default.
- Static/serverless production loads bundled `/configs/` files and saves the canonical `FinancialModelDocument` under `net-worth-estimator:financial-model` in browser storage.
- Malformed persisted data is not silently replaced; parsing and validation diagnostics are returned to the UI.
- Browser reset removes `net-worth-estimator:financial-model` and reloads the bundled `/configs/` files.
- Serverless deployments should use a backend `FinancialModelRepository` for shared or cross-device persistence.
- Files under `public/` are public static assets in deployed builds.
- Production hosts must rewrite browser routes such as `/settings` and `/model-inputs` to `index.html`.

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

## Architecture

- `src/App.tsx`: persistent routed controller for document loading and projection execution
- `src/runtime/`: narrow model, projection-artifact, and execution-status providers shared across routes
- `src/pages/ResultsPage.tsx`: read-only projection and evaluation outputs
- `src/pages/SettingsPage.tsx`: session-only projection and evaluation configuration
- `src/pages/ModelInputsPage.tsx`: canonical model inputs, temporary changes, templates, and source actions
- `src/hooks/useFinancialModel.ts`: TanStack Query wrappers for load, save, and reset
- `src/store.ts`: `ModelOverrides`, document editor, runtime settings, read-only comparison metrics, and theme state
- `src/engine/WorkerProjectionEngine.ts`: deterministic and stochastic Web Worker facade
- `src/components/ProjectionDashboard.tsx`: projection dashboard
- `src/components/ModelInputsInspector.tsx`: scheduled transactions, paginated one-time history, account rules, and canonical editing UI
- `src/components/ModelValidationPanel.tsx`: parsing and validation diagnostics
- `src/components/CurrentChangesControls.tsx`: session-only override controls
- `src/components/CurrentChangesComparison.tsx`: read-only metric snapshots
- `src/lib/projection/model/`: canonical document override handling
- `src/lib/projection/simulation/`: request preparation, shared transitions, deterministic kernel, and path adaptation
- `src/lib/projection/evaluation/`: path and branch evaluations
- `src/lib/projection/analysis/`: deterministic and stochastic orchestration

See `TECHNICAL_OVERVIEW.md` for the detailed data flow and engine contracts.
