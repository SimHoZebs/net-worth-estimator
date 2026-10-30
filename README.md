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

Offline replacement from `backend/` requires an existing user. Set `USER_ID` to
the verified resource ID from `/v1/auth/session`. Stop the application first:

```bash
go run ./cmd/importcsv \
  -db /path/to/net-worth-estimator.db \
  -user "$USER_ID" \
  -model ../public/configs
```

## Persistence and Access

- One application SQLite file holds each user's financial data, including the guest's data, and application sessions.
- Every financial table is user-scoped. The verified issuer and subject identify its owner.
- There is no HTTP reset route. Use a database backup and the offline import tool for replacement.
- Canonical edits and artifacts survive redeployment only when the SQLite file is on durable storage.

Database setup is a deployment step, not server initialization:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /private/application.db
```

The server requires that existing, compatible database. It never creates a missing
database or repairs its schema. Use the same path in `NET_WORTH_ESTIMATOR_DB`.

`setupdb` creates a fresh database or validates an existing current schema. It
does not upgrade older schemas or repair incomplete ones. Version upgrades use
separate one-time operator scripts, with the app stopped and a verified backup.

Legacy one-database-per-model layouts are unsupported. See
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
`--source-user "$SOURCE_USER"` when the source contains several private users.
Use
`./scripts/dev refresh-db --user "$TARGET_USER" --source-user "$SOURCE_USER"`
to refresh one user's financial data without resetting identities or passkeys.
See [the dev guide](dev/README.md) for tailnet setup, private user data, published guest data,
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
For independent frontend/API hosts, use the [host-portable deployment guide](deploy/README.md).
It covers Vercel's same-origin API proxy, Render, configurable ports, authenticated
ingress, explicit database maintenance, and host cutover without application changes.

The frontend is available at `http://localhost:8080` and the API at `http://localhost:8787`. Stop the stack with `docker compose down`; use `docker compose down -v` only when you intend to delete the SQLite volume.

The root `Dockerfile` remains a legacy combined image. The split images do not embed or build one another, and the legacy image and Compose stack must not run against the same volume or port at the same time.

Casdoor authentication is required in dev and production. The Go API verifies OIDC identity and calls Casdoor's built-in Casbin permission API. Each user owns separate financial data. The guest is an ordinary provisioned user with limited grants assigned at creation. Normal signup assigns member access without a role-choice step. Every request uses the same authorization path. Identities and financial data stay in local SQLite. Signed logout notifications and periodic token checks enforce provider revocation. The frontend and API must share one public origin. There are no shared bearer tokens or unauthenticated server modes. See [authentication](docs/authentication.md) and [user authorization](docs/authorization.md) for boundaries and migration.

Any frontend host must proxy `/v1` to the backend under the same public origin for session cookies and CSRF protection. A proxy cut during a seeded stochastic run detaches the client without an error event; repeat the same request to attach or read the saved result.

Configure a backend service with this durable contract:

| Setting                | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Build                  | `backend/Dockerfile` with repository root context                  |
| Port                   | `PORT`, default `8787`; bind `HOST=0.0.0.0`                       |
| Health checks          | readiness `GET /readyz`; liveness `GET /healthz` on `PORT`         |
| Instances              | `1`                                                                |
| Persistent volume      | `/data`                                                            |
| Database               | `NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db`              |
| Public exposure        | only behind suitable access control                                |
| Optional origin policy | exact origins in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`             |
| Authentication         | Casdoor OIDC, durable sessions, and user-scoped permissions |
| Optional write policy  | `NET_WORTH_ESTIMATOR_READ_ONLY=1`                                  |

Keep one backend instance because the deployment contract uses one SQLite writer. Back up through SQLite-aware procedures and preserve the persistent volume across deploys.
