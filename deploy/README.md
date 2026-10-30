# Host-portable deployment

The frontend and API can use different providers. They share one public browser
origin through a reverse proxy. Neither application contains provider addresses.
SQLite and Casdoor remain separate stateful dependencies. Database-engine and
identity-provider migrations are outside this contract.

Application/data migrations use [the shared migration SOP](MIGRATIONS.md).
Every configured deployment adapter invokes the target image's `/app/migrate.sh`
with the API stopped. It is not part of server startup.

## Runtime contract

| Component | Contract |
| --- | --- |
| Frontend | Static `frontend/dist` assets, built with Node.js 24 or newer |
| API | `backend/Dockerfile` with repository-root context, or the Go server binary |
| Browser API | `/v1/*` on the frontend's HTTPS origin, including `/v1/auth/*` |
| Process | One always-on API instance, with outbound access to Casdoor and enabled integrations |
| Listener | `HOST=0.0.0.0`, configurable `PORT` (default `8787`) |
| Storage | Existing compatible SQLite file on durable, writable local storage |
| Schema | Explicit `setupdb` operation with the API stopped |
| Liveness | `GET /healthz` reports process availability |
| Readiness | `GET /readyz` checks the database connection with a two-second deadline |
| Probes | No session, proxy secret, or user header required; no private data returned |
| Shutdown | Deliver `SIGTERM`; allow at least 15 seconds for HTTP shutdown |

Startup validates schema compatibility and OIDC discovery before it listens.
Readiness does not continuously test Casdoor. Identity outages fail closed on
authenticated requests when verification is due. Monitor those failures too.

The scheduler, sync exclusion, token-refresh coordination, and active seeded
simulations use process memory. Multiple replicas and scale-to-zero are outside
this contract. Process replacement loses unfinished simulations. Completed
results, financial data, and application sessions persist in SQLite.

## Reverse-proxy contract

Build the same frontend assets on every
host. Route `/v1/*` to the API without changing the browser's origin. Preserve
paths, queries, bodies, `Origin`, cookies, `Set-Cookie`, and API response headers.
Keep API responses private and uncached.

Two ingress arrangements are supported:

1. **Host-preserving proxy:** Preserve browser `Host` and `Origin`. Forward the
   public HTTPS scheme. Leave `NET_WORTH_ESTIMATOR_PROXY_SECRET` unset. Existing
   Nginx and Compose deployments retain this behavior.
2. **Authenticated proxy:** Set the same private `NET_WORTH_ESTIMATOR_PROXY_SECRET`
   on the proxy and API. Replace these headers at the proxy, after client input:

   | Header | Value |
   | --- | --- |
   | `Waypoint-Proxy-Secret` | The shared secret |
   | `Waypoint-Public-Origin` | The exact configured public origin, such as `https://app.example.com` |

Use 32–256 URL-safe characters for the secret. Generate 32 random bytes as
hexadecimal with a password manager or `openssl rand -hex 32`. Never put the
secret in `VITE_*`, a client bundle, committed file, URL, or log.

The API uses a constant-time digest comparison. It accepts only application
origins and provider aliases from identity configuration. It normalizes Host
and scheme before identity, CSRF, and CORS checks, then removes ingress headers.
Unknown origins, duplicate headers, and incorrect secrets fail closed. Forwarded
headers alone cannot select a login or callback address.

The proxy must enforce its configured public hostname before it assigns that
origin. It must preserve browser `Origin`. Vercel's configuration enforces the
hostname match and replaces both ingress headers. Direct API requests fail
with 403 in authenticated-proxy mode, except the two infrastructure probes.
Use the frontend URL for CLI requests and Casdoor's signed back-channel logout
callback. The API accepts one secret; coordinate proxy/API secret rotation.

### Streaming

Deliver stochastic POST responses incrementally. Preserve `text/event-stream`,
disable buffering and caching, and permit long response bodies. The API flushes
an initial response and sends heartbeats every 15 seconds. Avoid Function wrappers.
Vercel's external proxy permits 120 seconds before the first byte and between
subsequent data. This is an inactivity limit, not a two-minute total duration.
Verify actual provider behavior after deployment.

## GHCR container images

`.github/workflows/images.yml` builds each `main` commit once on GitHub Actions.
It publishes Linux AMD64 images with `sha-<full commit>` tags and OCI source/revision
labels. The workflow uses its short-lived `GITHUB_TOKEN`, not a personal token.
Every action is pinned to a commit. No deployment credentials enter the build.

| Image | Runtime |
| --- | --- |
| `ghcr.io/simhozebs/net-worth-estimator-backend` | API and maintenance binaries |
| `ghcr.io/simhozebs/net-worth-estimator-frontend` | Nginx frontend and same-origin proxy |
| `ghcr.io/simhozebs/net-worth-estimator-casdoor-upstream` | Pinned Casdoor runtime for the home stack |

The Casdoor mirror preserves the upstream command and files. The default
`auth/casdoor/Dockerfile` target still provides the separate environment-rendered
Northflank wrapper. Builds can pull upstream base images from Docker Hub. Home
deployments pull the completed GHCR images instead of building from source.

New GHCR packages start private. Set these three packages to public once in
GitHub package settings before anonymous hosts pull them. Do not use an expiring
workflow token as a production registry credential. Production pins resolved
image digests, and only advances after the complete publishing workflow succeeds.
Keep the previous digest references for rollback. Databases and runtime secrets
remain on the existing hosts. Vercel and Northflank retain their current pipelines.

Validate the publisher with `actionlint .github/workflows/images.yml` and
`node --test deploy/images.test.mjs`. The first successful Actions run verifies
the actual registry upload. Verify anonymous manifest access before cutover.

## Vercel frontend

Use the repository root as the project directory and Node.js 24 or newer.
The root `vercel.mjs` exports programmatic configuration. It reads deployment
settings before the build and uses direct external rewrites, not Functions.

Set these variables in Vercel's Environment Variables settings:

| Variable | Example |
| --- | --- |
| `BACKEND_URL` | `https://your-api.onrender.com` |
| `NET_WORTH_ESTIMATOR_PUBLIC_URL` | `https://app.example.com` |
| `NET_WORTH_ESTIMATOR_PROXY_SECRET` | The same private secret as the API |
| `NET_WORTH_ESTIMATOR_AUTH_ISSUER` | The Casdoor issuer origin |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID` | The registered application client ID |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET` | The registered application client secret |
| `NET_WORTH_ESTIMATOR_OWNER_SUBJECT` | The verified owner OIDC subject |
| `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` | The provisioned guest OIDC subject (anonymous traffic resolves to it) |
| `NET_WORTH_ESTIMATOR_AUTH_ORGANIZATION` | Optional; defaults to `waypoint` |

Both URLs must be HTTPS origins without paths or credentials. Configuration
fails on missing settings or unsafe secrets.
The upstream URL stays in routing configuration, outside the frontend bundle.
The secret uses a deployment environment reference, not a literal config value.

Only the configured frontend hostname matches the API proxy route. Alternate
Vercel hostnames serve static files but do not proxy API requests. Give previews
their own exact hostname, isolated backend, identity client, database, and secret.
Never give untrusted preview code production access. Register each callback and
post-logout URL in Casdoor explicitly.

Static files retain normal static-host behavior. Unknown paths return the
bundled 404 page. Fragment navigation requires no SPA catch-all rewrite.

## API on Render or another container host

The same image works on any host that meets the runtime contract. On Render:

| Setting | Value |
| --- | --- |
| Dockerfile | `backend/Dockerfile` |
| Build context | Repository root |
| Compute | Paid always-on service, one instance |
| Persistent disk | `/data` |
| Health-check path | `/readyz` |
| Normal Docker Command | Leave empty to use `/app/server` |

Set `HOST=0.0.0.0`, the provider's `PORT`, and
`NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db`. Supply Casdoor settings
from [the authentication guide](../docs/authentication.md). Set
`NET_WORTH_ESTIMATOR_PUBLIC_URL` to the frontend origin, not the API hostname.
For Vercel, also set the shared `NET_WORTH_ESTIMATOR_PROXY_SECRET`. Keep identity
and database credentials only on the API. Casdoor needs browser and API access.

The image runs as UID/GID `10001`. Its data mount must support that identity.
If permissions differ, ask the platform administrator to prepare disk ownership.
Do not run the API as root. A non-root shell and private SSH directory support
provider maintenance access.

### Explicit disk maintenance on Render

Render disks are unavailable during builds, pre-deploy commands, and one-off
jobs. Each disk belongs to one running instance. Disk-backed deployments have
downtime. Do not put SQLite setup in a pre-deploy command.

For initial setup or a schema upgrade, deploy an explicit maintenance process
instead of the API. Use this temporary Docker Command:

```sh
/bin/sh -c 'mkdir -p /tmp/maintenance; printf "maintenance\n" > /tmp/maintenance/readyz; exec busybox-extras httpd -f -p "$PORT" -h /tmp/maintenance'
```

This process serves only the maintenance directory and health-check file. It
runs no API, sessions, or scheduler. Use the service's normal non-ephemeral
Shell/SSH session, which has the attached disk. For a fresh database, execute:

```sh
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB"
```

Before guest-data publication, provision the destination row with the issuer
and guest subject from private `bootstrap.json` (`issuer` and `guest_subject`).
Otherwise, the first authorized access creates its empty workspace through the
same path as other users. The provider's viewer group limits guest access.
Repeat setup preserves existing database and user rows:

```sh
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer "$ISSUER" --subject "$NET_WORTH_ESTIMATOR_GUEST_SUBJECT"
```

Hosts configured to use `/app/render-free-boot.sh` run schema setup only before
the server. That wrapper never provisions guest or other user workspaces.
Casdoor's initial deployment seed still creates the guest identity.

For existing data, restore a verified current-schema SQLite-safe backup or run a
separate one-time operator upgrade. `setupdb` only validates an existing schema,
and rejects older or incomplete ones. See the
[database maintenance contract](../docs/shared-database.md). Back up before schema
changes. Keep the API stopped. Ephemeral shells do not share the disk.

The pending [shared migration](MIGRATIONS.md) runs `/app/migrate.sh` from the
target image before API startup. It converts legacy checkpoint dates to UTC
day-close instants. It also enables settled bank rows and aligns their event
times with posting times. Manual, pending, and void rows stay unchanged.
Legacy API-set exclusions are indistinguishable from the old import default,
so this one-time conversion enables those settled rows too. Final-schema
retries only verify and preserve later exclusions. Use the stopped-API
adapter with the original mount. Do not run a separate host-side converter.
After validation, clear the temporary Docker Command and redeploy. Normal API
startup never provisions storage. Repeat maintenance only for explicit operations.

## Switch hosts without application changes

1. Keep stable custom application and Casdoor hostnames where possible.
2. Prepare destination runtime settings and durable storage.
3. If storage must move, stop all API writers and take a SQLite-safe backup.
4. Restore and validate the complete application database on the destination.
5. Preserve Casdoor state, issuer, subjects, signing keys, and client settings.
6. Update the proxy upstream and route the stable application hostname.
7. Verify login, private access, writes, streaming, and restart persistence.

Never use independent writable database copies as a cutover strategy. After
destination writes, rollback requires reconciliation or an accepted loss of
those writes. Browser drafts and cookies belong to their origin. An origin
change can require sign-in and draft export. A stable origin avoids that issue.

## Verification

```sh
node --test deploy/vercel.test.mjs scripts/smoke-compose.test.mjs
docker build -f backend/Dockerfile -t waypoint-deployment-test .
DEPLOYMENT_TEST_IMAGE=waypoint-deployment-test node --test deploy/container.test.mjs
```

The image test uses disposable state without external networking. It checks a
non-default port, readiness, non-root command override, explicit setup,
schema-only boot without user creation, and proxy bypass rejection.
Go integration tests use real HTTP/TLS, a mock OIDC provider,
real API writes, CSRF rejection, incremental streaming, and restart persistence.

For an actual deployment with a provisioned guest scope:

```sh
FRONTEND_URL=https://app.example.com sh scripts/smoke-compose.sh
```

This smoke checks public proxy access, readiness, origin rejection, guest-scope
resolution without a session kind, and final SSE completion. Also verify real
Casdoor login/logout, user isolation, private writes, passkeys, signed logout
delivery, incremental streaming, and restarts with disposable users. Never use
production financial data as a fixture. The published `source_path` value
`sample` is a content-only label; it implies no permissions.

## Provider references

- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites and secret headers](https://vercel.com/docs/routing/rewrites)
- [Vercel external-proxy inactivity timeout](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes)
- [Render Docker command overrides](https://render.com/docs/docker)
- [Render persistent-disk restrictions](https://render.com/docs/disks)
- [Render maintenance shell access](https://render.com/docs/ssh)
