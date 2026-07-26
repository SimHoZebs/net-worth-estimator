# Net Worth Estimator

Single-page React app for inspecting a CSV-backed financial model and projecting net worth with deterministic and Monte Carlo simulation.

The product model is intentionally generic:

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked signed balances, scheduled postings, and daily-compounded growth between event dates.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- `amountMode` is `fixed` or `percent_of_base`; percentage rows use the latest realized amount of another posting.
- Annual caps are generic, and source-funded rows clamp to the source account's available positive balance.
- Financial independence is derived from annual expense coverage and a full principal-preservation cycle. Explicit continuing postings and shared account constraints drive reactive withdrawals.
- Monte Carlo confidence is aggregated from complete run outcomes, never inferred from percentile-band slope.
- Baseline edits are persisted by the active `DataSource`. `ModelOverrides`, shown as current changes, are session-only and never mutate the canonical document.
- `ComparisonSnapshot` records read-only metrics for comparison. It does not store or restore an alternative model.

## CSV Files

The app reads these CSV files under `public/configs/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`
- `behavior/financial-independence.csv`
- `behavior/net-worth-threshold.csv`
- `behavior/posting-fulfillment.csv`

Each behavior file is a typed table. All tables start with `instanceId`, `label`, and `enabled`, followed by definition-specific columns. Financial independence stores its scalar plan fields directly and uses JSON only for `sources` and `continuingPostingIds`; net-worth threshold adds `target`; posting fulfillment adds `postingIds`. Evaluation types follow the global `EVALUATION_TYPE_ORDER`, while rows within a type retain their physical CSV ingestion order. `instanceId` must be unique across behavior files, and one file may contain multiple instances.

`financial-independence.csv` configures branch simulation, including source selections, continuing postings, withdrawal policy, and confidence. `net-worth-threshold.csv` and `posting-fulfillment.csv` configure read-only path evaluations.

## Persistence

- Local development (`npm run dev`) uses `GET/PUT /api/financial-model`; saves write to `public/configs/` in the checkout.
- Static/serverless production loads bundled `/configs/` files and saves the canonical `FinancialModelDocument` under `net-worth-estimator:financial-model:v1` in browser storage.
- If canonical browser data exists, it wins. Otherwise, `net-worth-estimator:scenario-pack:v1` is read, migrated to the canonical key, and removed.
- Malformed persisted data is not silently replaced; parsing and validation diagnostics are returned to the UI.
- Serverless deployments should use a real backend `DataSource` for shared or cross-device persistence.
- Do not deploy private financial CSV files in `public/configs/`; those files are public static assets.

## Compatibility

`/api/scenario/pack` and deprecated scenario-named type/function aliases remain only for legacy consumers. Retain the aliases, legacy browser key, and compatibility route until downstream consumers have migrated and the compatibility window is deliberately closed.

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

- `src/App.tsx`: data-source selection and orchestration for document loading, current changes, projections, editing, and comparisons
- `src/hooks/useFinancialModel.ts`: TanStack Query wrappers for load, save, and reset
- `src/store.ts`: `ModelOverrides`, document editor, runtime settings, read-only comparison metrics, and theme state
- `src/engine/WorkerProjectionEngine.ts`: deterministic and stochastic Web Worker facade
- `src/components/ProjectionDashboard.tsx`: projection dashboard
- `src/components/ModelInputsInspector.tsx`: model tables and editing UI
- `src/components/ModelValidationPanel.tsx`: parsing and validation diagnostics
- `src/components/CurrentChangesControls.tsx`: session-only override controls
- `src/components/CurrentChangesComparison.tsx`: read-only metric snapshots
- `src/lib/projection/model/`: canonical document override handling
- `src/lib/projection/simulation/`: request preparation, shared transitions, deterministic kernel, and path adaptation
- `src/lib/projection/evaluation/`: path and branch evaluations
- `src/lib/projection/analysis/`: deterministic and stochastic orchestration

See `TECHNICAL_OVERVIEW.md` for the detailed data flow and engine contracts.
