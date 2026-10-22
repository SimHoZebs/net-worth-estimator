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

Offline replacement from `backend/`:

```bash
go run ./cmd/importcsv \
  -db /path/to/net-worth-estimator.db \
  -model ../public/configs \
  -income ../public/data/income
```

## Persistence and Access

- The SQLite file is authoritative for the canonical model, income snapshot, sync state, and projection artifacts.
- There is no HTTP reset route. Use a database backup and the offline import tool for replacement.
- Canonical edits and artifacts survive redeployment only when the SQLite file is on durable storage.

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

Use `setup --from /path/backup.db` for an existing backup. Use `./scripts/dev refresh-db`
to refresh financial data explicitly without resetting accounts or passkeys.
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

Run both services with the persistent local volume:

```bash
docker compose up --build
```

The frontend is available at `http://localhost:8080` and the API at `http://localhost:8787`. Stop the stack with `docker compose down`; use `docker compose down -v` only when you intend to delete the SQLite volume.

The root `Dockerfile` remains a legacy combined image. The split images do not embed or build one another, and the legacy image and Compose stack must not run against the same volume or port at the same time.

Optional [local authentication](auth/README.md) adds Casdoor through a Compose overlay. The Go API verifies OIDC identity and calls Casdoor's built-in Casbin permission API. Each account owns a separate private plan. Guests can read and project only a separately published sample. No role choice is required at signup. Identities and plans stay in local SQLite. Signed logout notifications and periodic token checks enforce provider revocation. Provider mode requires the frontend and API on the same public origin. See [authentication](docs/authentication.md) and [plan authorization](docs/authorization.md) for boundaries and migration. The Better Auth comparison remains on branch `experiment/better-auth`.

For Vercel in legacy mode, set `VITE_API_BASE_URL` to the public backend origin. Add that exact frontend origin to `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`. A proxy cut during a seeded stochastic run detaches the client without an error event; repeat the same request to attach or read the saved result.

Configure a backend service with this durable contract:

| Setting                | Value                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Build                  | `backend/Dockerfile` with repository root context                                     |
| Port                   | `8787`                                                                                |
| Health check           | `GET /healthz` on port `8787`                                                         |
| Instances              | `1`                                                                                   |
| Persistent volume      | `/data`                                                                               |
| Database               | `NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db`                                 |
| Public exposure        | only behind suitable access control                                                   |
| Optional origin policy | exact origins in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`                                |
| Optional write policy  | `NET_WORTH_ESTIMATOR_READ_ONLY=1` or a secret-backed `NET_WORTH_ESTIMATOR_AUTH_TOKEN` |

Keep one backend instance because the deployment contract uses one SQLite writer. Back up through SQLite-aware procedures and preserve the persistent volume across deploys.
