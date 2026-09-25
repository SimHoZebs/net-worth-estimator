# AGENTS.md - Net Worth Estimator Backend

## Start

From the repository root:

```bash
NET_WORTH_ESTIMATOR_DB=/tmp/net-worth-estimator.db \
NET_WORTH_ESTIMATOR_MODEL_PATH="$PWD/public/configs" \
NET_WORTH_ESTIMATOR_INCOME_PATH="$PWD/public/data/income" \
NET_WORTH_ESTIMATOR_FRONTEND_PATH="$PWD/frontend/dist" \
CGO_ENABLED=0 go -C backend run ./cmd/server
```

The server listens on `127.0.0.1:8787` by default. Seed paths are resolved from the process working directory, so use absolute paths when starting through `go -C`. The optional `NET_WORTH_ESTIMATOR_FRONTEND_PATH` enables built frontend assets and SPA fallback.

## Backend Map

| Path | Responsibility |
| --- | --- |
| `backend/cmd/server/` | configuration, startup, graceful shutdown, SimpleFIN scheduler |
| `backend/cmd/importcsv/` | offline CSV replacement into an existing SQLite database |
| `backend/internal/api/` | HTTP routes, CORS, bearer guard, deterministic API, stochastic SSE, artifact identity |
| `backend/internal/types/` | persisted model, income, request, result, evaluation, and validation types |
| `backend/internal/store/` | `Store`, SQLite migrations, model/income persistence, sync ownership, bounded artifacts |
| `backend/internal/domain/` | validation, request preparation, shared transitions, simulation, evaluations, stochastic kernels |
| `backend/internal/csvio/` | canonical model and income CSV import |
| `backend/internal/simplefin/` | Bridge client, mapping, scheduler-safe runner, dry-run, mock fixture mode |
| `backend/scripts/` | verification and benchmark entry points |
| `scripts/` | backend smoke and Northflank operator inspection |

## Runtime Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `HOST` | `127.0.0.1`; container `0.0.0.0` | listen address |
| `PORT` | `8787` | listen port |
| `NET_WORTH_ESTIMATOR_DB` | per-user SQLite path; container `/data/net-worth-estimator.db` | canonical data and artifacts |
| `NET_WORTH_ESTIMATOR_MODEL_PATH` | `public/configs` | first-boot model seed directory |
| `NET_WORTH_ESTIMATOR_INCOME_PATH` | `public/data/income` | first-boot income seed directory |
| `NET_WORTH_ESTIMATOR_FRONTEND_PATH` | empty | built frontend directory for same-origin static serving and SPA fallback |
| `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` | empty | comma-separated exact HTTP/S origins; same-origin requests are allowed automatically |
| `NET_WORTH_ESTIMATOR_READ_ONLY` | writable | `1`, `true`, or `yes` rejects guarded writes with 403 |
| `NET_WORTH_ESTIMATOR_AUTH_TOKEN` | empty | bearer token for guarded writes |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` | empty | Bridge Access URL secret; enables real sync |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS` | empty | `bridge-id=model-account-id,...` mapping |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS` | empty | model account IDs eligible for pending-charge seeds |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN` | empty | exact value `1` plans counts without committing writes |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK` | empty | exact value `1` enables fixture mode |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK_FILE` | empty | optional fixture file, valid only with mock mode |

## API and Persistence Flow

- `api.New(store.Store, api.Config)` builds the router. `GET /healthz`, `GET/PUT /v1/financial-model`, `GET /v1/status`, `GET /v1/income-data`, `POST /v1/projections/deterministic`, `POST /v1/projections/stochastic`, and `POST /v1/sync/simplefin` are the current routes.
- `GET /v1/financial-model` returns an `ETag` and revision; `PUT /v1/financial-model` requires `If-Match`, returns 428 when it is missing, and returns 412 for a stale content identity.
- `PUT /v1/financial-model` validates against the stored income snapshot. Error diagnostics return the document and issues without persisting it; warning-only documents are persisted.
- `api.Config.FrontendDir` optionally serves the built Waypoint frontend with same-origin static assets and SPA fallback.
- The read-only guard runs before bearer validation on model saves and sync triggers. A missing or wrong bearer returns 401 when a token is configured. Reads and projection computation remain unguarded.
- `store.Open` applies schema migrations and enables SQLite WAL, foreign keys, a 5-second busy timeout, and one connection. An empty database is seeded once from CSV by `cmd/server`; later CSV edits do not replace stored data.
- `store.Store` is the persistence boundary. `SaveDocument` atomically replaces owner rows while preserving sync-owned rows; `SaveDocumentIfUnchanged` rejects stale content identities. Checkpoints and postings carry `source: "model" | "simplefin"`; sync-owned checkpoint collisions yield to owner rows.
- Completed deterministic and seeded stochastic results are best-effort cached in `projection_artifacts`. The cache is bounded to 256 rows across both kinds. Partial results are not persisted. Unseeded stochastic runs are neither shared nor cached.
- The root `Dockerfile` runs as UID/GID `10001`, listens on `0.0.0.0:8787`, and stores SQLite at `/data/net-worth-estimator.db`. Production durability requires `/data` on persistent storage and one service instance.

## Simulation Rules

- `types.ApplyModelOverrides` creates the effective request document without mutating canonical state. `ModelOverrides` is request-scoped and is never stored.
- `domain.ValidateFinancialModel` is the authoritative cross-field validator. IDs, references, dates, amount descriptors, dependencies, account bounds, and evaluation configs are validated before simulation.
- `PrepareSimulationRequest` applies overrides, replays history, resolves the projection dates, and creates one `SimulationRequest`.
- Historical preparation merges enabled one-time postings and recurring occurrences needed for checkpoint replay with checkpoints. Same-date postings execute first by ascending priority and declaration order; checkpoints then overwrite observed account balances. A checkpoint on the projection start suppresses start-date events.
- Historical execution carries balances, latest realized posting amounts, and annual-cap state. It does not emit projected movement or evaluation events.
- `Simulate` accepts only a prepared request. Posting structure, not IDs, labels, or account categories, selects external inflow, external outflow, or transfer behavior.
- All deterministic, financial-independence branch, and stochastic execution uses `TransitionRuntime` in `domain/transitions.go`. Behavior-generated withdrawals emit `AccountMovementAction`; they do not mutate balances directly.
- Source-funded movements clamp to positive withdrawable balance, destinations clamp to ceiling headroom, and annual caps apply per posting and calendar year. Movement records retain requested and realized amounts plus ordered account deltas.
- `AdaptSimulationRun` separates historical rows from projected rows and rounds public projection values. `ProjectFinancialModelDocument` adds configured evaluation results.
- `EvaluationRegistry` owns the three definitions: financial independence, net-worth threshold, and posting fulfillment. Evaluation instance IDs are globally unique; `types.EvaluationTypeOrder` fixes type order while each table preserves stored row order.
- Financial independence uses explicit selected sources and continuing posting IDs. It never infers continuation from a posting's identity, label, category, or rate.
- `StochasticProjection` reuses one prepared baseline request, samples annual rates up front, simulates on a worker pool, and accumulates results in submission order. Percentiles come from complete sorted run distributions.

## Stochastic SSE

- A seeded request is content-addressed. A cache hit emits one `result` event; a miss owns an in-process shared run; an attached stream receives the latest cumulative `partial` snapshot and then remaining events.
- Event names are `progress`, `partial`, `result`, and `error`. Data shapes are `{progress}`, `{progress, partial}`, `{result}`, and `{error}` respectively.
- The stream sends `retry: 3000` and heartbeat comments every 15 seconds. `X-Cache` is `hit`, `miss`, or `attach`.
- An unseeded `seed: null` run stays attached to that request, is canceled on disconnect, and is never persisted.

## Core Go APIs

| Symbol | Contract |
| --- | --- |
| `store.Open`, `store.Store` | migrated persistence and synchronization boundary |
| `api.New`, `api.Server`, `api.Config` | HTTP wiring and access policy |
| `domain.ValidateFinancialModel` | model and income cross-validation |
| `domain.PrepareSimulationRequest` | overrides, history, dates, state, and request preparation |
| `domain.Simulate` | deterministic movement kernel |
| `domain.AdaptSimulationRun`, `domain.ProjectRawFinancialModelDocument` | path and public-result adaptation |
| `domain.ProjectFinancialModelDocument` | deterministic projection plus evaluations |
| `domain.EvaluateProjectionPath` | configured evaluation execution |
| `domain.StochasticProjection` | sampled projection, evaluation accumulation, percentiles, progress |
| `simplefin.Runner.Sync`, `simplefin.Runner.Trigger` | scheduled/direct and guarded manual synchronization |

## Verification

Run the narrowest relevant package first, then the production-package gate:

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/...
backend/scripts/verify.sh ./cmd/...
```

The script runs `gofmt` checks, `go vet`, and `go test` with `CGO_ENABLED=0`. CI additionally runs `go mod tidy` checking, production-package `go build`, and `go test -race`. The no-argument script also discovers the copy-only benchmark template under `backend/scripts/`; that template currently prevents a repository-wide gate and is excluded from CI and hooks.

See `README.md`, `TECHNICAL_OVERVIEW.md`, and `TESTING.md` for runtime and verification detail. `PRODUCT_INTENT.md` defines product intent independently of this implementation.
