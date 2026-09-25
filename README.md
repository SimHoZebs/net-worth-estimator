# Net Worth Estimator Backend

Go API and SQLite persistence for financial-model validation, deterministic projection, stochastic projection, configured evaluations, and SimpleFIN balance synchronization.

## Domain Model

A financial model contains:

- **Accounts** with signed balances, generic minimum and maximum bounds, and enablement.
- **Balance checkpoints** that record an absolute end-of-day account balance.
- **Postings** that create external inflows, external outflows, or account-to-account transfers.
- **Evaluations** that apply financial-independence, net-worth-threshold, and posting-fulfillment questions to a projection.
- **Income data** with effective-dated annual gross income and tax profiles.

The domain rules are structural and general:

- Opening balances are produced by replaying enabled one-time postings dated before the projection start.
- Historical postings and checkpoints execute chronologically. Same-date postings execute first by priority and declaration order; checkpoints then overwrite the observed accounts as end-of-day truth.
- A checkpoint on the projection start suppresses projected start-date events because that date is already observed.
- Posting frequency is one-time, daily, weekly, monthly, quarterly, or annual.
- Source-funded movements cannot remove more than the source's positive withdrawable balance. Destinations cannot exceed their ceiling headroom. Annual caps apply per posting and calendar year.
- Amount descriptors use explicit inputs and validated providers. The `income` resolver uses effective-dated income data and an ordered resolver pipeline.
- Public projection values are rounded after exact simulation. Stochastic bands come from complete sorted run distributions, not from interpolation between a few sample points.
- `ModelOverrides` can add or disable rows for one projection request without changing persisted model state.

`PRODUCT_INTENT.md` describes the product independently. This repository currently provides the backend contracts and semantics; it does not prescribe an interaction design.

## HTTP API

The server listens on `127.0.0.1:8787` by default.

| Method and path | Contract |
| --- | --- |
| `GET /healthz` | returns `ok` |
| `GET /v1/financial-model` | returns `{ "document": FinancialModelDocument | null, "issues": [], "revision": "sha256..." }` and an `ETag` header |
| `PUT /v1/financial-model` | validates a `FinancialModelDocument`; requires an `If-Match` revision; returns the document, issues, and revision; persists only when no error-severity issue exists and the revision still matches |
| `GET /v1/status` | returns `{ "readOnly": bool, "authEnabled": bool }` |
| `GET /v1/income-data` | returns the effective `IncomeDataSnapshot` |
| `POST /v1/projections/deterministic` | accepts optional `document`, `overrides`, and `incomeData` plus `settings`; returns `{ "result": ProjectionResult }`, validation issues, or an error; `X-Cache` is `hit` or `miss` |
| `POST /v1/projections/stochastic` | accepts the same effective inputs plus `config: { "runCount": int, "seed": int64 | null }`; returns an SSE stream |
| `POST /v1/sync/simplefin` | runs an immediate SimpleFIN synchronization and returns row counts; returns 503 when sync is unconfigured, 409 while a run is active, and 429 inside the manual-trigger interval |

When a projection omits both `document` and `incomeData`, it uses one stored snapshot. If only one is supplied, the other is loaded from storage.

Stochastic SSE emits:

- `progress` with `{ "progress": StochasticProgress }`;
- `partial` with `{ "progress": StochasticProgress, "partial": StochasticProjectionResult }`;
- `result` with `{ "result": StochasticProjectionResult }`;
- `error` with `{ "error": string }`.

A seeded miss sets `X-Cache: miss`; an attached in-process run sets `X-Cache: attach`; a completed cache hit sets `X-Cache: hit`. Partial results are cumulative snapshots and are not persisted. An unseeded run uses fresh draws, is not shared, and is canceled when the stream disconnects.

## CSV Seed Data

The server seeds an empty database from:

```text
public/configs/
├── accounts.csv
├── checkpoints.csv
├── postings.csv
└── behavior/
    ├── financial-independence.csv
    ├── net-worth-threshold.csv
    └── posting-fulfillment.csv

public/data/income/
├── income-sources.csv
└── tax-profiles.csv
```

Set `NET_WORTH_ESTIMATOR_MODEL_PATH` and `NET_WORTH_ESTIMATOR_INCOME_PATH` to use other seed directories. CSV files seed an empty database and support the explicit offline `cmd/importcsv` replacement tool. They do not resynchronize a populated database on server restart.

Offline replacement from `backend/`:

```bash
go run ./cmd/importcsv \
  -db /path/to/net-worth-estimator.db \
  -model ../public/configs \
  -income ../public/data/income
```

## Persistence and Access

- `store.Open` uses the pure-Go SQLite driver, WAL mode, foreign keys, a 5-second busy timeout, one connection, and forward schema migrations.
- The SQLite file is authoritative for the canonical model, income snapshot, sync state, and completed projection artifacts.
- `SaveDocument` atomically replaces owner rows. `SaveDocumentIfUnchanged` performs the same replacement only when the caller's ETag still matches the stored content. Rows use `source: "model" | "simplefin"`. Stored sync-owned rows survive model saves, and owner checkpoints win key collisions.
- `NET_WORTH_ESTIMATOR_READ_ONLY=1`, `true`, or `yes` rejects `PUT /v1/financial-model` and `POST /v1/sync/simplefin` with 403 before bearer validation.
- When `NET_WORTH_ESTIMATOR_AUTH_TOKEN` is non-empty, guarded routes require `Authorization: Bearer <token>`. Missing or incorrect values return 401. Reads and projection computation remain available.
- `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` accepts comma-separated exact HTTP/S origins. Same-origin requests are allowed automatically; configured origins are also allowed. A request carrying any other origin is rejected, while a request without an origin passes. Behind a TLS-terminating proxy, forward exactly one valid `X-Forwarded-Proto` and `X-Forwarded-Host` value, or configure the public HTTPS origin explicitly. Origin filtering is not authorization for direct API callers.
- There is no HTTP reset route. Use a database backup and the offline import tool for operator-controlled replacement.
- Completed projection artifacts are best-effort cached. The cache is bounded to 256 deterministic and stochastic rows combined. Cache failures fail open; requested projection computation still runs.
- Canonical edits and cached artifacts survive redeployment only when the SQLite file is on durable storage.

## SimpleFIN Synchronization

SimpleFIN is optional and narrow:

- mapped accounts produce balance checkpoints;
- configured card accounts produce disabled one-time postings for pending negative charges;
- checking transactions, positive card transactions, posted charges, and refunds are not materialized;
- pending seeds use the reserved `sfin-pending-` namespace and snapshot replacement per card account;
- the Access URL stays server-side and is absent from successful payloads; transport failures can wrap the request URL, so failed trigger responses and scheduler logs must be treated as sensitive;
- `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN=1` returns planned counts and rolls back all writes;
- a scheduler runs daily shortly after 03:00 local time with a random minute offset;
- the guarded trigger endpoint permits one in-flight run and spaces successful manual runs by 20 hours;
- fixture mode is for local verification only and follows the same mapping, ownership, and persistence path as a real run.

A model save that removes an account referenced by sync-owned rows preserves that account so observations and postings cannot become orphaned. Sync rows are not garbage-collected; operators must keep mappings valid or purge affected source rows deliberately.

## Run from Source

From the repository root:

```bash
NET_WORTH_ESTIMATOR_DB=/tmp/net-worth-estimator.db \
NET_WORTH_ESTIMATOR_MODEL_PATH="$PWD/public/configs" \
NET_WORTH_ESTIMATOR_INCOME_PATH="$PWD/public/data/income" \
NET_WORTH_ESTIMATOR_FRONTEND_PATH="$PWD/frontend/dist" \
CGO_ENABLED=0 go -C backend run ./cmd/server
```

The `go -C` command changes the process working directory to `backend`, which is why the seed paths above are absolute. Build the frontend first, or omit `NET_WORTH_ESTIMATOR_FRONTEND_PATH` for an API-only process. The default local database path is under the operating system's per-user configuration directory; `/tmp` keeps test runs isolated.

## Container and Northflank Contract

The root `Dockerfile` builds the Go server and Waypoint frontend, runs the server as UID/GID `10001`, listens on `0.0.0.0:8787`, serves the frontend at `/`, and defaults SQLite to `/data/net-worth-estimator.db`.

Local durable-container run:

```bash
docker build -t net-worth-estimator-server .
docker run --rm -p 8787:8787 \
  -v net-worth-estimator-data:/data \
  net-worth-estimator-server
```

Configure a Northflank combined service with this durable contract:

| Setting | Value |
| --- | --- |
| Build | root `Dockerfile` |
| Port | `8787` |
| Health check | `GET /healthz` on port `8787` |
| Instances | `1` |
| Persistent volume | `/data` |
| Database | `NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db` |
| Public exposure | only behind suitable access control |
| Optional origin policy | exact origins in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` |
| Optional write policy | `NET_WORTH_ESTIMATOR_READ_ONLY=1` or a secret-backed `NET_WORTH_ESTIMATOR_AUTH_TOKEN` |

Keep one service instance because the deployment contract uses one SQLite writer. Back up through SQLite-aware procedures and preserve the persistent volume across deploys.

## Scripts

Backend verification and benchmarks:

```bash
backend/scripts/verify.sh ./internal/... # gofmt, vet, and test backend internals
backend/scripts/verify.sh ./cmd/...      # gofmt, vet, and test backend commands
backend/scripts/bench-sim.sh deterministic
```

The no-argument `backend/scripts/verify.sh` also discovers the copy-only benchmark template under `backend/scripts/`, which currently prevents a repository-wide gate. CI and hooks use the production-package commands above.

Operator checks:

```bash
BASE_URL=http://127.0.0.1:8787 scripts/smoke-backend.sh
scripts/nf-status.sh --help
```

The smoke script expects health, model, and sync endpoints to return 200. Run it against a writable, unauthenticated instance with SimpleFIN configured; otherwise exercise the guarded routes directly as described in `TESTING.md`.

## Go Architecture

- `backend/cmd/server/main.go`: environment parsing, first-boot seed, HTTP server, graceful shutdown.
- `backend/internal/api/server.go`: `api.New`, `api.Config`, and route registration.
- `backend/internal/api/projection_handlers.go`: deterministic request resolution and artifact lookup.
- `backend/internal/api/stochastic_sse.go`: seeded shared runs, event serialization, and unseeded request-bound runs.
- `backend/internal/store/store.go`: `Store` interface, `store.Open`, schema migrations, SQLite connection policy.
- `backend/internal/store/model.go`: atomic canonical replacement and ordered reload.
- `backend/internal/store/sync.go`: row ownership and transactional sync application.
- `backend/internal/domain/validation.go`: authoritative model and income cross-validation.
- `backend/internal/domain/prepare.go`: overrides, history, dates, and initial simulation state.
- `backend/internal/domain/transitions.go`: shared movement and income execution.
- `backend/internal/domain/simulate.go`: prepared deterministic kernel.
- `backend/internal/domain/path.go`: historical/projected path adaptation and public rounding.
- `backend/internal/domain/evaluation_runtime.go`: evaluator registry and deterministic/stochastic runtimes.
- `backend/internal/domain/stochastic.go`: sampling, worker execution, ordered accumulation, and progress.
- `backend/internal/simplefin/`: Bridge protocol, mapping, runner, fixture mode, and dry-run.

See `TECHNICAL_OVERVIEW.md` for request and persistence flows, SSE details, simulation invariants, evaluations, and artifact identity.
