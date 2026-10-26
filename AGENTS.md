# AGENTS.md - Net Worth Estimator Backend

## Start

Use the production-like Compose dev stack from the repository root:

```bash
./scripts/dev setup # once, including existing dev stacks
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

Use the frontend URL printed by setup. The local profile uses
`http://localhost:5178`. Casdoor is on 8000, and the private API debug port is
8788. Use the same API, Nginx frontend, and Casdoor images as production.
Daily lifecycle commands use the dedicated `docker-compose.dev.yml`, not a wrapper.
Dev state persists in gitignored `.env.dev` and `tmp/dev/`.
Setup takes a SQLite-safe, read-only production database snapshot.
`./scripts/dev refresh-db` explicitly refreshes financial data and preserves
identity/session state. Use `setup --from /path/backup.db` for an existing backup.
SimpleFIN stays disabled. See `dev/README.md` for commands and account access.
For remote tailnet use, initialize with `setup --tailnet` after the operator sets
the two HTTPS Serve routes in the guide. Saved profiles persist across restarts.
Use the printed HTTPS hostname, not a raw tailnet IP over HTTP. Never reset the
host's shared Serve configuration or silently change an existing identity issuer.

Vite and direct Go processes are advanced source-debugging tools, not the normal
manual-test entry point. Stop the dev frontend before using Vite on 5178.
The isolated browser-test harness still uses its own fixture API and ports.

## Deployment

`backend/Dockerfile` builds the API image. `frontend/Dockerfile` builds a static Nginx image that serves the SPA and proxies `/v1` to the backend named by `BACKEND_URL`. Initialize Casdoor and use the authenticated split stack in `auth/README.md`, with the persistent `net-worth-estimator-data` volume. The root `Dockerfile` is a legacy combined image.

The frontend image is environment-independent. All deployments proxy `/v1` under the frontend's public origin for Casdoor session cookies and CSRF protection. Dev and production require Casdoor configuration and a verified owner for existing financial data. Shared bearer tokens and unauthenticated server startup are retired. `NET_WORTH_ESTIMATOR_READ_ONLY` remains a global write kill switch.

## Backend Map

| Path                          | Responsibility                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `backend/cmd/server/`         | configuration, startup, graceful shutdown, SimpleFIN scheduler                                          |
| `backend/cmd/importcsv/`      | offline CSV replacement into an existing SQLite database                                                |
| `backend/internal/api/`       | HTTP routes, CORS, read-only kill switch, deterministic API, stochastic SSE, artifact identity            |
| `backend/internal/types/`     | persisted model (postings, recurrence rules, claims), request, result, evaluation, and validation types |
| `backend/internal/store/`     | `Store`, SQLite schema, model persistence, sync ownership, bounded artifacts                            |
| `backend/internal/domain/`    | validation, request preparation, shared transitions, simulation, evaluations, stochastic kernels        |
| `backend/internal/csvio/`     | canonical model CSV import                                                                              |
| `backend/internal/simplefin/` | Bridge client, mapping, scheduler-safe runner                                                          |
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
| `NET_WORTH_ESTIMATOR_AUTH_PROVIDER`                  | `casdoor`                                                      | required OIDC sessions and plan permissions; token-only and unauthenticated startup are unsupported            |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MIN_TRIGGER_INTERVAL` | `6h`                                                           | Go duration spacing successful manual sync triggers; Bridge expects 24 requests or fewer per day             |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_RATE_LIMIT_COOLDOWN`  | `1h`                                                           | Go duration Bridge-fetch blackout after an upstream 429; excess triggers return local 429 with `Retry-After` |

## API and Persistence Flow

- `api.New(store.Store, api.Config)` builds the router. Current routes: `GET /healthz`, `GET /v1/financial-model`, row endpoints under `/v1/accounts`, `/v1/postings`, `/v1/recurrence-rules`, `/v1/checkpoints`, `/v1/evaluations`, `/v1/payment-terms`, amount presets under `/v1/amount-presets`, pinned evaluations under `/v1/pinned-evaluations`, SimpleFIN credential endpoints under `/v1/sync/simplefin/credential` (`GET`/`POST`/`DELETE`), card selection under `/v1/sync/simplefin/cards` (`GET`/`PUT`), link endpoints under `/v1/sync/simplefin/accounts`, device sign-in under `/v1/auth/device/` (`start`, `poll`, `refresh`), `GET /v1/status` (includes `syncHost` when configured), `GET /v1/amount-resolvers`, `POST /v1/projections/deterministic`, `POST /v1/projections/stochastic`, and `POST /v1/sync/simplefin`. The Bridge key and card selection live only in the plan database; the old `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` and `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS` environment variables are retired and ignored. The `nwe` CLI in `backend/cmd/nwe` authenticates through the device flow and calls the same API with Bearer tokens.

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
