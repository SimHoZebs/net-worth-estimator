# Host-portable deployment

The frontend and API can use different providers. They share one public browser
origin through a reverse proxy. Neither application contains provider addresses.
SQLite and Better Auth remain separate stateful dependencies. Database-engine and
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
| Process | One always-on API instance, with outbound access to Better Auth and enabled integrations |
| Listener | `HOST=0.0.0.0`, configurable `PORT` (default `8787`) |
| Storage | Existing compatible SQLite file on durable, writable local storage |
| Schema | Explicit `setupdb` operation with the API stopped |
| Liveness | `GET /healthz` reports process availability |
| Readiness | `GET /readyz` checks the database connection with a two-second deadline |
| Probes | No session, proxy secret, or user header required; no private data returned |
| Shutdown | Deliver `SIGTERM`; allow at least 15 seconds for HTTP shutdown |

Startup validates schema compatibility and OIDC discovery before it listens.
Readiness does not continuously test Better Auth. Identity outages fail closed on
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
Use the frontend URL for CLI requests and the provider's signed back-channel logout
callback. The API accepts one secret; coordinate proxy/API secret rotation.

### Streaming

Deliver stochastic POST responses incrementally. Preserve `text/event-stream`,
disable buffering and caching, and permit long response bodies. The API flushes
an initial response and sends heartbeats every 15 seconds. Avoid Function wrappers.
Vercel's external proxy permits 120 seconds before the first byte and between
subsequent data. This is an inactivity limit, not a two-minute total duration.
Verify actual provider behavior after deployment.

## Deployment guides

- [Vercel frontend](vercel.md) — project settings, env vars, preview isolation, gated production deploy.
- [API on Render or another container host](render.md) — service settings, disk maintenance, setupdb usage.
- [GHCR container images](images.md) — published images, digest pins, publisher checks.
- [Shared migration SOP](MIGRATIONS.md) — one-time `/app/migrate.sh` contract every adapter runs.

## Switch hosts without application changes

1. Keep stable custom application and identity hostnames where possible.
2. Prepare destination runtime settings and durable storage.
3. If storage must move, stop all API writers and take a SQLite-safe backup.
4. Restore and validate the complete application database on the destination.
5. Preserve identity state, issuer, subjects, signing keys, and client settings.
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
Better Auth login/logout, user isolation, private writes, passkeys, signed logout
delivery, incremental streaming, and restarts with disposable users. Never use
production financial data as a fixture. The published `source_path` value
`sample` is a content-only label; it implies no permissions.
