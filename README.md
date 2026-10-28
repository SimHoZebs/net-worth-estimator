# Net Worth Estimator Backend

Go API and SQLite persistence for financial-model validation, deterministic projection, stochastic projection, configured evaluations, and SimpleFIN balance synchronization. `PRODUCT_INTENT.md` describes the product independently.

## CSV Seed Data

The server never reads CSV directories. An empty database stays empty until import. The directories below back the offline `cmd/importcsv` replacement tool and `cmd/fixtureapi` browser-test seeding.

```text
public/configs/
├── accounts.csv
├── checkpoints.csv
├── postings.csv
├── recurrence-rules.csv
└── behavior/
    ├── financial-independence.csv
    ├── net-worth-threshold.csv
    └── posting-fulfillment.csv

public/data/income/
├── income-sources.csv
└── tax-profiles.csv
```

Offline replacement from `backend/` requires an existing plan. Set `PLAN_ID` to
the verified resource ID from `/v1/auth/session`. Stop the application first:

```bash
go run ./cmd/importcsv \
  -db /path/to/net-worth-estimator.db \
  -plan "$PLAN_ID" \
  -model ../public/configs
```

## Persistence and Access

- One application SQLite file holds all private plans, the published sample, and application sessions.
- Every financial table is plan-scoped. Each private plan belongs to a verified application account.
- There is no HTTP reset route. Use a database backup and the offline import tool for replacement.
- Canonical edits and artifacts survive redeployment only when the SQLite file is on durable storage.

Database setup is a deployment step, not server initialization:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /private/application.db
```

The server requires that existing, compatible database. It never creates a missing
database or repairs its schema. Use the same path in `NET_WORTH_ESTIMATOR_DB`.

Legacy per-plan databases are unsupported. See
[the shared database guide](docs/shared-database.md). Runtime startup never merges
legacy files or assigns their ownership from the first login.

## SimpleFIN Synchronization

SimpleFIN sync writes balance checkpoints and disabled pending-charge postings. Sync rows are not garbage-collected; keep mappings valid or purge source rows deliberately.

## Development

```bash
./scripts/dev setup # once, including existing dev stacks
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

Use **http://localhost:5178**, or the HTTPS URL printed by setup for tailnet access.
The dedicated dev Compose file uses the production Dockerfiles and pinned Casdoor
image with isolated dev storage. Setup takes the initial SQLite-safe, read-only
production snapshot. Daily Compose commands retain data and logins without a
custom lifecycle wrapper. External sync stays disabled.

Use `setup --from /path/backup.db` for an existing shared-schema backup. Use
`--source-plan "$SOURCE_PLAN"` when the source contains several private plans.
Use
`./scripts/dev refresh-db --plan "$TARGET_PLAN" --source-plan "$SOURCE_PLAN"`
to refresh one financial plan without resetting accounts or passkeys.
See [the dev guide](dev/README.md) for tailnet setup, private plans, the guest sample,
logs, and state recovery.

## Run from Source (Advanced)

For low-level source debugging, run the API and Vite separately. Normal manual
testing uses the production-like dev stack above. Do not run both frontends on
5178 at the same time.

```bash
# terminal 1
# Local state comes from a database backup, never the shipped CSVs: copy a
# backup to the dev database path while the server is stopped. tmp/ is
# gitignored and survives reboot, unlike /tmp.
cp <backup>.db tmp/net-worth-estimator.db
NET_WORTH_ESTIMATOR_DB=$PWD/tmp/net-worth-estimator.db \
CGO_ENABLED=0 go -C backend run ./cmd/server
```

```bash
# terminal 2
npm --prefix frontend ci
npm --prefix frontend run dev
```

The Vite server runs on `http://localhost:5178` and proxies `/v1` to `127.0.0.1:8787`.

## Container Images and Compose

The split deployment has two images:

- `backend/Dockerfile` builds the Go API. Local state comes from a database backup restored to the volume, never from files baked into the image.
- `frontend/Dockerfile` builds the Waypoint bundle and serves it from Nginx. The image proxies `/v1` to the backend named by `BACKEND_URL` and keeps stochastic SSE streaming unbuffered.

Initialize Casdoor and run the split stack through the [authentication guide](auth/README.md).
For normal development, use the [dedicated dev stack](dev/README.md).

The frontend is available at `http://localhost:8080` and the API at `http://localhost:8787`. Stop the stack with `docker compose down`; use `docker compose down -v` only when you intend to delete the SQLite volume.

The root `Dockerfile` remains a legacy combined image. The split images do not embed or build one another, and the legacy image and Compose stack must not run against the same volume or port at the same time.

Casdoor authentication is required in dev and production. The Go API verifies OIDC identity and calls Casdoor's built-in Casbin permission API. Each account owns a separate private plan. Guests can read and project only a separately published sample. No role choice is required at signup. Identities and plans stay in local SQLite. Signed logout notifications and periodic token checks enforce provider revocation. The frontend and API must share one public origin. Shared bearer tokens and unauthenticated server startup are retired. See [authentication](docs/authentication.md) and [plan authorization](docs/authorization.md) for boundaries and migration. The Better Auth comparison remains on branch `experiment/better-auth`.

Any frontend host must proxy `/v1` to the backend under the same public origin for session cookies and CSRF protection. A proxy cut during a seeded stochastic run detaches the client without an error event; repeat the same request to attach or read the saved result.

Configure a backend service with this durable contract:

| Setting                | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Build                  | `backend/Dockerfile` with repository root context                  |
| Port                   | `8787`                                                             |
| Health check           | `GET /healthz` on port `8787`                                      |
| Instances              | `1`                                                                |
| Persistent volume      | `/data`                                                            |
| Database               | `NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db`              |
| Public exposure        | only behind suitable access control                                |
| Optional origin policy | exact origins in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`             |
| Authentication         | Casdoor OIDC, durable sessions, and account-owned plan permissions |
| Optional write policy  | `NET_WORTH_ESTIMATOR_READ_ONLY=1`                                  |

Keep one backend instance because the deployment contract uses one SQLite writer. Back up through SQLite-aware procedures and preserve the persistent volume across deploys.
