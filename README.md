# Net Worth Estimator

React app and Go API for inspecting a CSV-backed financial model and projecting net worth with deterministic and Monte Carlo simulation.

The product model is intentionally generic:

- Projection-start balances are derived by replaying enabled one-time postings dated before the projection start; net worth then evolves through scheduled postings and daily-compounded growth between event dates.
- Balance checkpoints are absolute end-of-day account observations. Historical postings are replayed chronologically, checkpoints correct the modeled balances on their dates, and later postings continue from the corrected state.
- A posting can be an external inflow, an external outflow, or an account-to-account transfer.
- Posting frequencies include explicit one-time (`once`) transactions.
- Postings use explicit amount resolvers with validated inputs; the optional `income` resolver runs an ordered payroll pipeline from separate effective-dated income data.
- Annual caps are generic, and source-funded rows clamp to the source account's available positive balance.
- Financial independence is derived from annual expense coverage and a full principal-preservation cycle. Explicit continuing postings and shared account constraints drive reactive withdrawals.
- Monte Carlo confidence is aggregated from complete run outcomes, never inferred from percentile-band slope.
- Baseline edits are persisted by the active `FinancialModelRepository`. The Editor draft (`workingDocument` plus the `editingBaseline` snapshot in `src/store.ts`), shown as current changes, is session-only and never mutates the canonical document.
- `ComparisonSnapshot` records read-only metrics for comparison. It does not store or restore an alternative model.

## CSV Files

The Go backend seeds its SQLite database from these CSV files under `public/configs/`; the browser never reads CSV directly:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`
- `behavior/financial-independence.csv`
- `behavior/net-worth-threshold.csv`
- `behavior/posting-fulfillment.csv`

The bundled `public/` files provide the default model and income data. `NET_WORTH_ESTIMATOR_MODEL_PATH` and `NET_WORTH_ESTIMATOR_INCOME_PATH` can point the Go API at alternate source directories.

Each behavior file is a typed table. All tables start with `instanceId`, `label`, and `enabled`, followed by definition-specific columns. Financial independence stores its scalar plan fields directly and uses JSON only for `sources` and `continuingPostingIds`; net-worth threshold adds `target`; posting fulfillment adds `postingIds`. Evaluation types follow the global `EVALUATION_TYPE_ORDER`, while rows within a type retain their physical CSV ingestion order. `instanceId` must be unique across behavior files, and one file may contain multiple instances.

`financial-independence.csv` configures branch simulation, including source selections, continuing postings, withdrawal policy, and confidence. `net-worth-threshold.csv` and `posting-fulfillment.csv` configure read-only path evaluations.

Income source definitions and tax profiles are loaded from `public/data/income/` and are served through `/v1/income-data`.

## Persistence

- The Go backend persists the canonical model and income data in SQLite. Set `NET_WORTH_ESTIMATOR_DB` to choose the database file.
- An empty database is seeded from `public/configs/` and `public/data/income/`. Later bundled CSV changes do not replace persisted data. There is no reset endpoint; CSV files are seed-only (first boot plus the offline `cmd/importcsv` operator tool).
- `NET_WORTH_ESTIMATOR_READ_ONLY=1` rejects canonical model writes with 403 while keeping reads and projections public.
- Write access is guarded by a single bearer token (`NET_WORTH_ESTIMATOR_AUTH_TOKEN`), sent from Settings as an `Authorization` header on save only. Serve exclusively behind HTTPS; a token captured over plain HTTP permits world-write replay.
- The optional SimpleFIN sync (daily scheduler plus bearer-guarded `POST /v1/sync/simplefin`) writes only balance checkpoints and projection-disabled pending card-charge seeds, all marked `source: "simplefin"`. It never materializes checking flows or posted history. Sync-owned rows cannot be edited through model saves; add your own checkpoint to override a synced balance. Removing a mapped account does not garbage-collect its sync rows — remap or delete them directly. Start with `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN=1`.
- Malformed persisted data is not silently replaced; parsing and validation diagnostics are returned to the UI.
- Editor draft changes remain session-only and never mutate the canonical data.
- Production deployments must place the SQLite database on durable storage.

## Run

```bash
npm install
npm run dev
```

In a second terminal, run the backend from the repository root:

```bash
cd backend
go run ./cmd/server
```

## Deploy The Backend To Northflank

The root `Dockerfile` builds only the Go API and includes the bundled seed CSVs. To run it locally with durable data:

```bash
docker build -t net-worth-estimator-server .
docker run --rm -p 8787:8787 \
  -v net-worth-estimator-data:/data \
  net-worth-estimator-server
```

Create a Northflank combined service from this repository with:

- **Build type:** Dockerfile
- **Dockerfile:** `/Dockerfile`
- **Build context:** `/`
- **Port:** HTTP `8787`; make it public only when an authentication or trusted-access layer protects it
- **Health check:** HTTP `GET /healthz` on port `8787`
- **Persistent volume:** mount at `/data`
- **Instances:** `1`, because the service uses one SQLite database file
- **Runtime variable:** `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS=https://<frontend-host>` when a browser frontend calls this service directly; separate multiple exact origins with commas
- **Command override:** none

The image supplies container defaults for `HOST`, `PORT`, the database path, and both seed paths. If `PORT` is overridden in Northflank, update the configured service port and health check to match.

The browser uses same-origin `/v1` routes by default. For a separately deployed frontend, set `VITE_API_BASE_URL=https://<backend-host>` in the frontend build environment. The value may contain a path prefix but must not include `/v1`; it applies to model persistence, income data, deterministic projections, and stochastic SSE streams. Add the frontend's exact origin, without a path, to the backend's `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` runtime variable.

### Automatic deploys from CI

`.github/workflows/deploy-backend.yml` ships every green `main` build to Northflank: after the `CI` workflow succeeds, it builds the backend image, pushes `ghcr.io/<owner>/net-worth-estimator-server:<sha>` (plus `latest`), and rolls the Northflank service to the new image. Pushes that touch no backend inputs (`backend/`, the seed dirs, `Dockerfile`, or the workflow itself) skip the deploy so the pod is never recycled pointlessly.

One-time setup:

1. **Northflank**: save your GHCR credentials as registry credentials and note the credentials ID. Create the backend as a **deployment** service (source: Northflank image, not a Dockerfile build) with the same shape as above — port `8787`, `GET /healthz` check, persistent volume on `/data`, **1 instance** (SQLite), and the same runtime variables. Note the project ID and service ID.
2. **Northflank**: create an API token with the **Update Deployment** permission.
3. **GitHub** (repo Settings → Secrets and variables → Actions): add secret `NORTHFLANK_API_KEY`, and variables `NORTHFLANK_PROJECT_ID`, `NORTHFLANK_SERVICE_ID`, `NORTHFLANK_CREDENTIALS_ID`.

The next qualifying `main` push deploys itself. Keep the Dockerfile-build combined service **or** the CI-driven deployment service, not both writing to the same `/data` volume.

Reads and deterministic/stochastic projections are public by design. Canonical model writes require the bearer token above (or are rejected entirely when read-only mode is on). CORS restricts browser origins only; it does not protect the API from non-browser clients, which is why writes are token-guarded server-side.

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
- `src/hooks/useFinancialModel.ts`: TanStack Query wrappers for load and save
- `src/store.ts`: Editor draft (`workingDocument` + `editingBaseline`), runtime settings, and read-only comparison metrics; theme lives in the separate `src/themeStore.ts` store
- `src/engine/BackendProjectionEngine.ts`: HTTP/SSE client for backend deterministic and stochastic projection
- `src/components/ProjectionDashboard.tsx`: projection dashboard
- `src/components/ModelInputsInspector.tsx`: scheduled transactions, paginated one-time history, account rules, and canonical editing UI
- `src/components/ModelValidationPanel.tsx`: parsing and validation diagnostics
- `src/components/CurrentChangesControls.tsx`: session-only override controls
- `src/components/CurrentChangesComparison.tsx`: read-only metric snapshots
- `src/lib/projection/model/`: amount presentation and checkpoint-surrogate helpers
- `backend/internal/domain/`: Go simulation kernel (request preparation, shared transitions, deterministic simulation, path adaptation)
- `src/lib/projection/evaluation/`: evaluation config validation, result accessors, and evaluator definitions
- `src/lib/analysis/`: posting-derived independent analyses (classification, payroll detection, salary estimation)

See `TECHNICAL_OVERVIEW.md` for the detailed data flow and engine contracts.
