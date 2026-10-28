# Testing

This checkout holds two packages: the Go backend in `backend/`, and the Waypoint frontend in `frontend/`. Both have their own gates. The backend is the calculation authority; the frontend renders its results and keeps local edits as a temporary review layer.

## Manual Development

Run `./scripts/dev setup` once, then use the dedicated dev Compose stack:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

This uses production Dockerfiles with isolated dev data, not the Vite/fixture API
browser-test harness. `./scripts/dev refresh-db` replaces only the dev financial
database from a consistent production snapshot.
See [dev/README.md](dev/README.md).

Dev setup checks: `node --test dev/*.test.mjs auth/casdoor/*.test.mjs`.
Configuration checks require the Docker Compose CLI, but no running daemon.

Posting UUID migration and exact upstream identity checks:

```bash
CGO_ENABLED=0 go -C backend test ./internal/store ./internal/types ./internal/csvio ./internal/simplefin ./internal/api
```

See [the posting identity contract](docs/posting-identity.md) for upgrade, backup,
reference preservation, and rollback behavior.

## Frontend Gates

Run from the repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

`typecheck` covers `frontend/tsconfig.json` and, separately, `frontend/tests/tsconfig.json`.

Font roles follow `frontend/src/styles/README.md`. `npm --prefix frontend run lint:typography` warns about font choices outside the shared owner without failing the command. The normal lint gate also runs it. Unit tests cover the lint rule's detection logic, not exact fonts, role classes, or rendered sizes.

`npm --prefix frontend run lint:styles` enforces Tailwind's spacing scale in JSX classes, typed recipes, and CSS declarations. It also rejects raw palette utilities, private class selectors, and component `@apply` selector APIs. `npm --prefix frontend run lint:fix` normalizes literal spacing values to that scale. Runtime variables, chart geometry, native state selectors, and calculated layout constraints remain valid.

## Frontend Browser Tests

The browser suite drives the real Go engine over real HTTP. `frontend/playwright.config.ts` starts two servers itself: the `fixtureapi` harness on port 8799, seeded from `frontend/tests/fixtures/`, and the Vite dev server on 5178 pointed at it. The harness returns a synthetic account and plan through the production session contract. It does not enable a legacy authentication mode in the frontend. No running backend of your own is needed, and none of your data is touched.

```bash
npm --prefix frontend exec playwright install chromium
npm --prefix frontend run test:browser
```

Run it from a stopped dev server on 5178, or it will reuse yours and test the wrong backend. The suite is single-worker because it shares one seeded server.

If another dev server uses 5178, set `TEST_FRONTEND_PORT=5179` to give the browser suite its own frontend port.

To exercise the production build instead of the dev server:

```bash
npm --prefix frontend run build
TEST_PRODUCTION=1 npm --prefix frontend run test:browser
```

## Completion Gate

Agents run the completion gates locally. The repository has no hosted CI workflows.

For a frontend change, the gate is:

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

For a backend change, it is the Go gate below.

The pre-commit hook verifies the backend packages containing staged Go files, plus `oxlint` and `oxfmt --check` on staged frontend files. The pre-push hook verifies `./internal/...` and `./cmd/...`, plus whole-project `oxlint`. Remaining frontend gates (`typecheck`, `test`, `build`, `test:browser`) run only when invoked directly.

## Shared Database Isolation

The application stores all plans and application identity state in one SQLite
database. Isolation tests must use at least two plans in that same physical file,
with identical entity IDs, preset names, and upstream sync keys. Separate fixture
files alone do not prove row-level isolation.

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/dbmigration
backend/scripts/verify.sh ./internal/plans
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api
```

Migration tests use disposable legacy sources and a new destination. They verify
source immutability, failed-import cleanup, ownership validation, private sync
identities, and application sessions. See [the migration guide](docs/shared-database.md).

Test fixtures provision through `store.SetupDatabase` before runtime opens. Startup
regressions verify that missing, empty, and incompatible databases create no files
or schema. Identity initialization must also reject incomplete tables without repair.

## Casdoor Authentication

Unit checks need no identity container:

```bash
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/authorization
backend/scripts/verify.sh ./internal/plans
backend/scripts/verify.sh ./internal/api
node --test auth/casdoor/*.test.mjs
```

`scripts/smoke-compose.sh` checks the guest sample on the authenticated stack.
Guests see only a separate sample.
Run its request-contract regressions with `node --test scripts/smoke-compose.test.mjs`.
Run the real-Nginx provider-header regression with
`NGINX_TEST_IMAGE=nginx:alpine node --test scripts/nginx-provider.test.mjs`.
The test requires an available local image and Docker. It runs without root
inside the container and checks both the corrected buffer and default-buffer 502.
Without `NGINX_TEST_IMAGE`, it skips the Docker-only test.
Authenticated requests use the account's private plan and assert its resource ID.

Use the [Casdoor test guide](auth/casdoor/README.md#verification) for real-provider
passkey, restart, revocation, refresh, and administrator recovery checks. The
lifecycle stack uses private disposable state under `tmp/`, not the live financial
volume. Do not create or restart Docker networks during a browser gate. Chromium
can abort module requests with `ERR_NETWORK_CHANGED` when host interfaces change.

Physical passkeys and phone recovery require the separate
[manual checklist](docs/authentication.md#manual-physical-device-and-recovery-checklist).

`go -C backend test ./internal/identity -run 'TestBrowser|TestProviderAlias|TestProviderProxy|TestSiblingApp'`
checks browser-origin redirects, callback binding, provider cookie isolation,
proxy transport, and sibling-origin denial. Additional browser aliases keep the
same issuer and account-owned resource IDs. See
[browser address configuration](docs/authentication.md#lan-and-tailnet-browser-addresses).

`auth/test-integration.mjs` checks owner, guest sample, and second-account isolation
against a marked disposable Casdoor fixture. `CASDOOR_TEST_MUTATIONS=1` is required.
Its `fixture.json` must identify isolated state under repository `tmp/` or
`/tmp/opencode/`, never live `tmp/dev/`. The script verifies the real permission
API, OIDC, CSRF, restart persistence, private writes, sample projection/SSE,
cross-account rejection, stale resource headers, and logout.
Signup checks include immediate blank-workspace access without administrator
approval or import, first-account editing, draft reload, and saved restart persistence.

---

# Backend

## Deployment portability

```bash
backend/scripts/verify.sh ./internal/ingress
go -C backend test ./internal/identity -run TestDeploymentProxy
backend/scripts/verify.sh ./cmd/server
node --test deploy/vercel.test.mjs scripts/smoke-compose.test.mjs
docker build -f backend/Dockerfile -t waypoint-deployment-test .
DEPLOYMENT_TEST_IMAGE=waypoint-deployment-test node --test deploy/container.test.mjs
```

These checks use disposable state, not the dev stack or production database.
They cover authenticated and Host-preserving HTTP proxies, real API writes,
CSRF denial, incremental streaming, persistent sessions and artifacts, public
probes, command overrides, and a provider-assigned API port. Run the image checks
locally before completion. See [the operator contract](deploy/README.md) for the
Vercel/Render settings and the separate actual-provider checklist.

The verification surface for the backend is its HTTP/SSE contract, CSV seed path, and SQLite persistence.

## Scoped Go Tests

Run the narrowest relevant package first:

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
```

`backend/scripts/verify.sh` sets `CGO_ENABLED=0` and runs:

1. `gofmt` check;
2. `go vet`;
3. `go test`.

Run the repository-wide gate to catch cross-package breakage:

```bash
backend/scripts/verify.sh
```

Direct commands are useful while diagnosing a failure:

```bash
cd backend
CGO_ENABLED=0 go test ./internal/domain/... -run 'TestGolden'
CGO_ENABLED=0 go test ./internal/api -run 'TestRowWriteReadOnlyMatrix|TestCORSMiddleware'
CGO_ENABLED=0 go test ./internal/store -run 'TestStoreConformance|TestPurgeSyncScriptClearsSyncRows'
CGO_ENABLED=0 go build ./...
```

In an environment with the race detector's supported CGO toolchain, run the production packages with the race detector:

```bash
go test -race ./internal/... ./cmd/...
```

Benchmark one complete projection:

```bash
backend/scripts/bench-sim.sh deterministic
backend/scripts/bench-sim.sh checkpoints
```

The actual benchmark run uses the checked-in fixture and the Go toolchain.

## Real-Data Server

Use a disposable database restored from a backup. Configure Casdoor and its verified primary-data owner through [the auth guide](auth/README.md). The server requires the same session configuration in dev and production. Copy a backup only while its database is stopped.

Direct API snippets below require a valid session cookie file, the discovered resource ID, and the configured public origin. Use only disposable credentials:

```bash
export COOKIE_FILE=/path/to/private/disposable-cookie-jar
export RESOURCE_ID=plans/your-discovered-resource-id
export PUBLIC_ORIGIN=http://localhost:8080
curl() {
  command curl --cookie "$COOKIE_FILE" \
    -H "Waypoint-Resource: $RESOURCE_ID" -H "Origin: $PUBLIC_ORIGIN" "$@"
}
```

Then start the disposable API with its identity settings in the environment:

```bash
export BASE_URL=http://127.0.0.1:8787
export NET_WORTH_ESTIMATOR_DB=$PWD/tmp/net-worth-estimator-test.db
unset NET_WORTH_ESTIMATOR_READ_ONLY

cp <backup>.db tmp/net-worth-estimator-test.db
CGO_ENABLED=0 go -C backend run ./cmd/server
```

The server reads the restored database; it never scans the CSV directories. To start from a clean snapshot, stop the server and restore the backup again (removing the `-shm`/`-wal` companions if present).

The defaults bind to `127.0.0.1:8787`. Set `HOST=0.0.0.0` only when another process must reach the listener.

## Direct Read Checks

Run these in another terminal:

```bash
curl -fsS "$BASE_URL/healthz"
printf '\n'

curl -fsS "$BASE_URL/v1/status" | jq .
curl -fsS "$BASE_URL/v1/financial-model" \
  | jq '{accounts: (.document.accounts | length), postings: (.document.postings | length), checkpoints: (.document.checkpoints | length), issues}'
```

Expected baseline:

- `/healthz` returns `ok`;
- `/v1/status` reports the process configuration;
- the model response returns 200;
- `issues` is an array;
- warning-severity model issues may be present, but a projection must not run with error-severity issues.

`POST /v1/position` accepts `{ "asOfDate": "YYYY-MM-DD", "document": ... }`.
The document is optional and defaults to the scoped stored model. It returns
`result: { asOfDate, netWorth, accounts: [{ accountId, balance }] }` from the same
historical preparation as projections, without a future simulation. It requires
`plan:project`, allows read-only/sample access, and stores no additional history.
Model/date errors return HTTP 200 with `issues` and `error`, without `result`.

`frontend/tests/position.spec.ts` holds forecast requests open to verify that the
current-position card and evidence work independently. It also checks separate
position/forecast failures and retries. Outlook hides previous-input forecast
placeholders until the active forecast arrives.

## Direct Projection Checks

Choose a projection start on or after the latest checkpoint. The following command derives that date from the stored model:

```bash
START_DATE="$(curl -fsS "$BASE_URL/v1/financial-model" \
  | jq -r '[.document.checkpoints[].Date] | max // empty')"
START_DATE="${START_DATE:-$(date -u +%F)}"

jq -n --arg start "$START_DATE" '{
  settings: {
    fallbackProjectionStartDate: $start,
    horizonYears: 1,
    evaluations: {
      financialIndependence: [],
      netWorthThreshold: [],
      postingFulfillment: []
    }
  },
  range: { startDate: "2000-01-01", endDate: "2100-01-01" }
}' > /tmp/deterministic-request.json

curl -fsS -D /tmp/deterministic-headers \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/deterministic-request.json \
  "$BASE_URL/v1/projections/deterministic" \
  | jq '{hasResult: (.result != null), issueCount: (.issues | length // 0), error}'

grep -i '^Projection-Source:' /tmp/deterministic-headers
```

Run the same request again. The second response should normally report `Projection-Source: stored` when result storage is available. A newly executed simulation reports `Projection-Source: computed`.

Seeded stochastic request:

```bash
jq '. + {config: {runCount: 20, seed: 42}}' \
  /tmp/deterministic-request.json > /tmp/stochastic-request.json

curl -fsS -N -D /tmp/stochastic-headers \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/stochastic-request.json \
  "$BASE_URL/v1/projections/stochastic" \
  | tee /tmp/stochastic-events.sse

grep -i '^Projection-Source:' /tmp/stochastic-headers
grep '^event:' /tmp/stochastic-events.sse
```

A small seeded run should terminate with one `result` event. It may include `progress` and `partial` events. Repeating the same request should produce `Projection-Source: stored` and one `result` event. A new run reports `computed`; attachment to an existing shared run reports `shared`. Sending `"seed": null` exercises the request-bound path; disconnecting that stream cancels its work and must not store a result.

## Session and Read-Only Matrix

Exercise each row through the real identity boundary against disposable state.

| Access                                        | Plan reads/projections                      | Canonical writes and manual sync                  |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Guest, sample resource                        | allowed                                     | 401                                               |
| Signed-in owner, own resource                 | allowed                                     | allowed, subject to validation/sync configuration |
| Signed-in owner, another resource             | 409 for stale resource assertion            | rejected                                          |
| Owner without write permission                | allowed when read/project permissions exist | 403                                               |
| Owner with global read-only enabled           | allowed                                     | 403                                               |
| Provider unavailable when verification is due | 503                                         | 503                                               |

A shared Authorization bearer header cannot replace a session or bypass a denied
permission. `AUTH_TOKEN` and `AUTH_PROVIDER=none` cause server startup to fail.
After each rejected write, confirm financial data stays unchanged. Row validation
can return 200 with error-severity issues and `persisted: false`.

`auth/test-integration.mjs` owns the disposable real-provider session, CSRF,
owner/sample/second-account, and logout checks. Go identity tests also check that
retired bearer headers cannot grant guest access.

## CORS Checks

Start with an exact allowlist:

```bash
export NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS=https://app.example.com
unset NET_WORTH_ESTIMATOR_READ_ONLY
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Allowed preflight with resource assertion:

```bash
curl -sS -o /dev/null -D - -X OPTIONS \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: Content-Type, Waypoint-Resource' \
  "$BASE_URL/v1/financial-model"
```

Expected status: 204.

Disallowed origin:

```bash
curl -sS -o /tmp/disallowed-origin.txt -w '%{http_code}\n' \
  -H 'Origin: https://other.example.com' \
  "$BASE_URL/v1/financial-model"
```

Expected status: 403.

Request without an origin:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL/healthz"
```

Expected status: 200. Also verify unsupported preflight methods and request headers are rejected.

## SimpleFIN Checks

For live Bridge verification, connect a key through the credential endpoint
with a writable owner session and its resource assertion (the retired
environment variables are ignored):

```bash
curl -fsS -X POST "$BASE_URL/v1/sync/simplefin/credential" \
  -H 'Content-Type: application/json' \
  --data-binary '{"setupToken":"<pasted-base64-token>"}' | jq .
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Then select card accounts and trigger, and inspect counts:

```bash
curl -fsS -X POST "$BASE_URL/v1/sync/simplefin" | jq .
```

The response reports `checkpointsInserted`, `pendingInserted`, and `accountsProvisioned`. Link a bridge account to a model account through `PUT /v1/sync/simplefin/accounts/{bridgeAccountId}` and list links with `GET` on the same path. Restart the server (clears the in-memory trigger stamp), trigger again, and confirm checkpoints resolve to the linked accounts. A second successful trigger inside the configured interval (default 6 hours) returns 429; the interval guard stamps successful runs only.

A guard test belongs in Go and runs with:

```bash
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/api
```

## Smoke Script

`scripts/smoke-backend.sh` performs health, model-summary, and sync-trigger requests and requires all three to return 200:

```bash
BASE_URL=http://127.0.0.1:8787 scripts/smoke-backend.sh
```

Supply `COOKIE_FILE`, `RESOURCE_ID`, and `PUBLIC_ORIGIN` for an authorized owner.
Use a disposable writable instance. For read-only, session, CORS, or
unconfigured-sync behavior, use direct checks with explicit expected statuses.

## Backend Completion Gate

For a backend change, finish with:

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
CGO_ENABLED=0 go -C backend build ./...
git diff --check
```

For persistence, HTTP policy, SSE, or synchronization changes, also perform the relevant direct checks above against a disposable database and record the observed status codes or event names.
