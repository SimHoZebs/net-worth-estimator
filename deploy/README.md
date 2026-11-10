# Host-portable deployment

The frontend and API can use different providers. They share one public browser origin through a reverse proxy, and neither application contains provider addresses. SQLite and Better Auth remain separate stateful dependencies. Database-engine and identity-provider migrations are outside this contract.

Application and data migrations run through the shared migration SOP in `MIGRATIONS.md`. Every deployment adapter invokes the target image's `/app/migrate.sh` with the API stopped; it is not part of server startup. Stop all API writers and take a verified backup before any migration.

## Runtime contract

| Component | Contract |
| --- | --- |
| Frontend | Static `frontend/dist` assets, built with Node.js 24 or newer |
| API | `backend/Dockerfile` with repository-root context, or the Go server binary |
| Browser API | `/v1/*` on the frontend's HTTPS origin, including `/v1/auth/*` |
| Process | One always-on API instance, with outbound access to Better Auth and enabled integrations |
| Listener | `HOST=0.0.0.0`, configurable `PORT` (default `8787`) |
| Storage | Existing compatible SQLite file on durable, writable local storage at `/data` |
| Database | `NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db` |
| Schema | Explicit `setupdb` operation with the API stopped |
| Liveness | `GET /healthz` reports process availability |
| Readiness | `GET /readyz` checks the database connection with a two-second deadline |
| Probes | No session, proxy secret, or user header required; no private data returned |
| Shutdown | Deliver `SIGTERM`; allow at least 15 seconds for HTTP shutdown |
| Public exposure | Only behind suitable access control |
| Origin policy | Exact origins in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` |
| Authentication | Better Auth on Bun, OIDC, durable sessions, and Go Casbin |
| Write policy | Optional `NET_WORTH_ESTIMATOR_READ_ONLY=1` |

Startup validates schema compatibility and OIDC discovery before it listens. Readiness does not continuously test Better Auth; identity outages fail closed on authenticated requests when verification is due. The scheduler, sync exclusion, token-refresh coordination, and active seeded simulations use process memory, so multiple replicas and scale-to-zero are outside this contract. Process replacement loses unfinished simulations; completed results, financial data, and application sessions persist in SQLite.

Stop the stack with `docker compose down`; use `docker compose down -v` only when you intend to delete the SQLite volume.

## Database setup

Provision the database once, before the API starts. `setupdb` creates the schema on a fresh database and validates it on an existing one. It never adds missing tables to an existing database and never provisions user workspaces beyond the explicit issuer and subject flags.

```bash
docker compose build backend
docker compose run --rm --no-deps --entrypoint /app/setupdb backend \
  --db /data/net-worth-estimator.db
docker compose up -d
```

Without Compose, run the same step from the repository root:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /private/application.db
CGO_ENABLED=0 go -C backend run ./cmd/setupdb \
  --db /private/application.db --issuer "$ISSUER" --subject "$GUEST_SUBJECT"
```

The API never creates a missing database and never repairs schema. Startup stops with an operator error when required tables are missing. Complete any one-time upgrade before the new API starts.

## Backups

Treat the whole application database as a credential store. It holds provider tokens and financial data for every user, so a full backup stays private and never serves as published guest data. Never copy a live database file alone; use the SQLite backup API and verify the backup before relying on it.

```bash
sqlite3 "$DB" ".backup '$BACKUP'"
sqlite3 "$BACKUP" 'PRAGMA integrity_check;'
sqlite3 "$BACKUP" 'SELECT COUNT(*) FROM pragma_foreign_key_check;'
```

Before new writes, restoring a verified backup returns the exact pre-upgrade state. After new writes, a rollback requires reconciliation or an accepted loss of those writes.

## Reverse proxy

Route `/v1/*` to the API without changing the browser's origin. Preserve paths, queries, bodies, `Origin`, cookies, `Set-Cookie`, and API response headers. Keep API responses private and uncached.

1. **Host-preserving proxy:** preserve browser `Host` and `Origin`, forward the public HTTPS scheme, and leave `NET_WORTH_ESTIMATOR_PROXY_SECRET` unset. Existing Nginx and Compose deployments use this mode.
2. **Authenticated proxy:** set the same private `NET_WORTH_ESTIMATOR_PROXY_SECRET` on the proxy and API, then replace these headers at the proxy after client input:

   | Header | Value |
   | --- | --- |
   | `Waypoint-Proxy-Secret` | The shared secret |
   | `Waypoint-Public-Origin` | The exact configured public origin |

Use 32 to 256 URL-safe characters for the secret, generated with `openssl rand -hex 32`. Never put it in `VITE_*`, a client bundle, a committed file, a URL, or a log. The API compares digests in constant time, accepts only application origins and provider aliases from identity configuration, and fails closed on unknown origins, duplicate headers, or incorrect secrets. The proxy must enforce its configured public hostname before assigning that origin and must preserve browser `Origin`. Direct API requests fail with 403 in authenticated-proxy mode, except the two infrastructure probes. Use the frontend URL for CLI requests and the provider's signed back-channel logout callback. The API accepts one secret; coordinate proxy and API secret rotation.

### Streaming

Deliver stochastic POST responses incrementally. Preserve `text/event-stream`, disable buffering and caching, and permit long response bodies. The API flushes an initial response and sends heartbeats every 15 seconds. Vercel's external proxy permits 120 seconds before the first byte and between subsequent data, an inactivity limit rather than a total duration. A proxy cut during a seeded stochastic run detaches the client without an error event; repeat the same request to attach or read the saved result.

## Deployment guides

- [Vercel frontend](vercel.md) — project settings, env vars, preview isolation, gated production deploy.
- [API on Render or another container host](render.md) — service settings, disk maintenance, setupdb usage.
- [GHCR container images](images.md) — published images, digest pins, publisher checks.
- [Shared migration SOP](MIGRATIONS.md) — one-time `/app/migrate.sh` contract every adapter runs.

## Switch hosts

1. Keep stable custom application and identity hostnames where possible.
2. Prepare destination runtime settings and durable storage.
3. If storage must move, stop all API writers and take a SQLite-safe backup.
4. Restore and validate the complete application database on the destination.
5. Preserve identity state, issuer, subjects, signing keys, and client settings.
6. Update the proxy upstream and route the stable application hostname.
7. Verify login, private access, writes, streaming, and restart persistence.

Never use independent writable database copies as a cutover strategy. After destination writes, rollback requires reconciliation or an accepted loss of those writes. Browser drafts and cookies belong to their origin; an origin change can require sign-in and draft export.

## Verification

```sh
node --test deploy/vercel.test.mjs scripts/smoke-compose.test.mjs
docker build -f backend/Dockerfile -t waypoint-deployment-test .
DEPLOYMENT_TEST_IMAGE=waypoint-deployment-test node --test deploy/container.test.mjs
FRONTEND_URL=https://app.example.com sh scripts/smoke-compose.sh
```

The image test uses disposable state without external networking and checks a non-default port, readiness, non-root command override, explicit setup, schema-only boot, and proxy bypass rejection. The smoke script checks public proxy access, readiness, origin rejection, guest-scope resolution, and final SSE completion. Also verify real Better Auth login and logout, user isolation, private writes, passkeys, signed logout delivery, incremental streaming, and restarts with disposable users. Never use production financial data as a fixture. The published `source_path` value `sample` is a content-only label; it implies no permissions.
