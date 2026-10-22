# AGENTS.md - Net Worth Estimator Backend

## Start

Use the production-like Compose dev stack from the repository root:

```bash
./scripts/dev up
./scripts/dev down
```

The frontend is `http://localhost:5178`, Casdoor is on 8000, and the API debug
port is 8788. Use the same API, Nginx frontend, and Casdoor images as production.
Dev data and private configuration persist in gitignored `tmp/dev/`.
First startup takes a SQLite-safe, read-only production database snapshot.
`./scripts/dev refresh-db` explicitly refreshes financial data and preserves
identity/session state. Use `up --from /path/backup.db` for an existing backup.
SimpleFIN stays disabled. See `dev/README.md` for commands and access grants.

Vite and direct Go processes are advanced source-debugging tools, not the normal
manual-test entry point. Stop the dev frontend before using Vite on 5178.
The isolated browser-test harness still uses its own fixture API and ports.

## Deployment

`backend/Dockerfile` builds the API image. `frontend/Dockerfile` builds a static Nginx image that serves the SPA and proxies `/v1` to the backend named by `BACKEND_URL`. `docker compose up --build` runs the split stack with a persistent `net-worth-estimator-data` volume. The root `Dockerfile` is a legacy combined image.

The frontend image is environment-independent. Vercel deployments set `VITE_API_BASE_URL` to the public backend origin, and the backend must allow that exact frontend origin through `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`. An unset `NET_WORTH_ESTIMATOR_AUTH_TOKEN` leaves guarded writes unauthenticated, and an unset `NET_WORTH_ESTIMATOR_READ_ONLY` leaves the backend writable.

## Backend Map

| Path                          | Responsibility                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `backend/cmd/server/`         | configuration, startup, graceful shutdown, SimpleFIN scheduler                                          |
| `backend/cmd/importcsv/`      | offline CSV replacement into an existing SQLite database                                                |
| `backend/internal/api/`       | HTTP routes, CORS, bearer guard, deterministic API, stochastic SSE, artifact identity                   |
| `backend/internal/types/`     | persisted model (postings, recurrence rules, claims), request, result, evaluation, and validation types |
| `backend/internal/store/`     | `Store`, SQLite schema, model persistence, sync ownership, bounded artifacts                            |
| `backend/internal/domain/`    | validation, request preparation, shared transitions, simulation, evaluations, stochastic kernels        |
| `backend/internal/csvio/`     | canonical model CSV import                                                                              |
| `backend/internal/simplefin/` | Bridge client, mapping, scheduler-safe runner, dry-run, mock fixture mode                               |
| `backend/scripts/`            | verification and benchmark entry points                                                                 |
| `scripts/`                    | backend smoke and container smoke                                                                       |
| `backend/Dockerfile`          | API-only container image                                                                                |
| `frontend/Dockerfile`         | static frontend image and runtime API proxy                                                             |
| `docker-compose.yml`          | split local/full-stack deployment                                                                       |

## Runtime Configuration

| Variable                                             | Default                                                        | Effect                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `HOST`                                               | `127.0.0.1`; container `0.0.0.0`                               | listen address                                                                                               |
| `PORT`                                               | `8787`                                                         | listen port                                                                                                  |
| `NET_WORTH_ESTIMATOR_DB`                             | per-user SQLite path; container `/data/net-worth-estimator.db` | canonical data and artifacts                                                                                 |
| `NET_WORTH_ESTIMATOR_MODEL_PATH`                     | `public/configs`                                               | CSV directory for `cmd/fixtureapi` browser-test seeding; the server never reads it                           |
| `NET_WORTH_ESTIMATOR_FRONTEND_PATH`                  | empty                                                          | optional built frontend directory for binary-only same-origin static serving                                 |
| `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`                | empty                                                          | comma-separated exact HTTP/S origins for direct cross-origin API access                                      |
| `NET_WORTH_ESTIMATOR_READ_ONLY`                      | writable                                                       | `1`, `true`, or `yes` rejects guarded writes with 403                                                        |
| `NET_WORTH_ESTIMATOR_AUTH_TOKEN`                     | empty                                                          | bearer token for guarded writes                                                                              |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL`           | empty                                                          | Bridge Access URL secret; enables real sync                                                                  |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS`                | empty                                                          | model account IDs eligible for pending-charge seeds                                                          |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN`              | empty                                                          | exact value `1` plans counts without committing writes                                                       |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK`                 | empty                                                          | exact value `1` enables fixture mode                                                                         |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK_FILE`            | empty                                                          | optional fixture file, valid only with mock mode                                                             |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MIN_TRIGGER_INTERVAL` | `6h`                                                           | Go duration spacing successful manual sync triggers; Bridge expects 24 requests or fewer per day             |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_RATE_LIMIT_COOLDOWN`  | `1h`                                                           | Go duration Bridge-fetch blackout after an upstream 429; excess triggers return local 429 with `Retry-After` |

## API and Persistence Flow

- `api.New(store.Store, api.Config)` builds the router. Current routes: `GET /healthz`, `GET /v1/financial-model`, row endpoints under `/v1/accounts`, `/v1/postings`, `/v1/recurrence-rules`, `/v1/checkpoints`, `/v1/evaluations`, `/v1/payment-terms`, amount presets under `/v1/amount-presets`, pinned evaluations under `/v1/pinned-evaluations`, link endpoints under `/v1/sync/simplefin/accounts`, `GET /v1/status`, `GET /v1/amount-resolvers`, `POST /v1/projections/deterministic`, `POST /v1/projections/stochastic`, and `POST /v1/sync/simplefin`.

## Core Go APIs

| Symbol                                                                 | Contract                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `store.Open`, `store.Store`                                            | SQLite persistence and synchronization boundary                    |
| `api.New`, `api.Server`, `api.Config`                                  | HTTP wiring and access policy                                      |
| `domain.ValidateFinancialModel`                                        | model cross-validation                                             |
| `domain.PrepareSimulationRequest`                                      | overrides, history, dates, state, and request preparation          |
| `domain.Simulate`                                                      | deterministic movement kernel                                      |
| `domain.AdaptSimulationRun`, `domain.ProjectRawFinancialModelDocument` | path and public-result adaptation                                  |
| `domain.ProjectFinancialModelDocument`                                 | deterministic projection plus evaluations                          |
| `domain.EvaluateProjectionPath`                                        | configured evaluation execution                                    |
| `domain.StochasticProjection`                                          | sampled projection, evaluation accumulation, percentiles, progress |
| `simplefin.Runner.Sync`, `simplefin.Runner.Trigger`                    | scheduled/direct and guarded manual synchronization                |

## Verification

Run the narrowest relevant package first, then the production-package gate. `TESTING.md` defines the backend completion gate and direct checks.
