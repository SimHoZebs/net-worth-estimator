# Testing

This checkout holds the Go backend in `backend/`, the Waypoint frontend in `frontend/`, and the purchase-capture extension in `extension/`. Each has its own gates. The backend is the calculation authority; the frontend renders its results and saves each row through its editor. Failed edits stay local to the form for retry, and multi-row imports apply per row without an atomic whole-model promise.

Use `./scripts/test` as the single entry point:

```bash
scripts/test --unit          # no servers, Docker daemon, or credentials
scripts/test --integration   # playwright browser suite (fixtureapi + Vite over real HTTP)
scripts/test --all           # unit then integration
scripts/test --matrix        # integration edge-case suite per dataset-pack x identity-set (see docs/integration-edge-gates.md)
E2E_TEST_MUTATIONS=1 scripts/test --e2e  # disposable end-to-end gate (see below)
```

Unit is `backend/scripts/verify.sh` (`CGO_ENABLED=0` gofmt+vet+test), `bun --filter ./frontend test` (vitest over `src/**` and `scripts/**`, jsdom), `node --test dev/*.test.mjs auth/casdoor/*.test.mjs` (Compose CLI, no daemon), and `node --test auth/e2e-gate.test.mjs` (e2e budget/flake/fixture contract, no daemon). The vitest suite runs with `isolate: false`: all files share one worker, and `frontend/tests/setup.ts` clears DOM, storage, timers, and module state between files. A test that depends on fresh module singletons or leftover DOM will fail only when run with the suite, so run the whole file list, not just the new test. Integration boots servers or Docker images. The end-to-end gate covers the previously manual credential-gated tier (real-provider journeys, smoke scripts, proxy-header and deployment-image regressions, migration-on-image verification) against a disposable environment; physical passkeys, phone recovery, live external delivery, and any production mutation stay manual. `--all` covers tests only, not the `lint`/`typecheck`/`build` completion gates below. See `scripts/test --help` for the exact matrix.

The purchase-capture extension adds `bun --filter ./extension test` to unit and
`bun --filter ./extension test:browser` to integration. Install its dependencies
with `bun install --frozen-lockfile`. Its completion gate also includes
`bun --filter ./extension lint` and `bun --filter ./extension build`.
Browser tests use a disposable Chromium profile and ephemeral local HTTP fixture.
See [extension setup and verification](extension/README.md).

Standalone planned-purchase CRUD and user isolation run in the API/store suites.
The separate one-time upgrade script has its own tests under
`backend/scripts/one-time/planned-purchases/`, included in the backend gate.
Those tests cover conversion correctness, data safety, and rollback without
partial changes. See [purchase persistence](docs/purchase-queue.md#persistence).

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

Parallel agents use isolated slots instead of stopping the canonical stack or
stealing its ports. Setup picks three free loopback ports, clones the canonical
application database when one exists, and prints the slot URLs plus the exact Compose
invocation. State lives in `tmp/dev-<slot>/`, the env file is
`.env.dev.<slot>`, and the Compose project is `waypoint-dev-<slot>`. Slots are
loopback-only: `--tailnet` stays on the canonical stack.

```bash
scripts/dev setup --slot shots
docker compose --env-file .env.dev.shots -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev.shots -f docker-compose.dev.yml down
scripts/dev ps-all
```

Posting UUID migration and exact upstream identity checks:

```bash
CGO_ENABLED=0 go -C backend test ./internal/store ./internal/types ./internal/csvio ./internal/simplefin ./internal/api/...
```

## Frontend Gates

Run from the repository root:

```bash
bun install --frozen-lockfile
bun --filter ./frontend lint
bun --filter ./frontend typecheck
bun --filter ./frontend test
bun --filter ./frontend build
```

Frontend scripts carry no pre-hooks. Every gate entry generates the API client
explicitly and once; before running scripts directly, generate it yourself
with `bun --filter ./frontend api:generate`.

`typecheck` covers `frontend/tsconfig.json` and, separately, `frontend/tests/tsconfig.json`.
It runs on `bun check` for both projects; `build` runs the same `bun check` pass before `vite build`, so the
artifact path keeps type safety without a separate checker. Both configs avoid
`baseUrl`, which current checkers removed. The `typescript` package remains as
a parser library for the typography and style-scale lint scripts.

Refresh the checked-in OpenAPI snapshot without a running server or financial data:

```bash
OPENAPI_SNAPSHOT="$PWD/frontend/openapi.snapshot.json" CGO_ENABLED=0 \
  go -C backend test ./internal/api -run TestRawRoutesAppearInOpenAPI -count=1
(cd frontend && bunx --no-install oxfmt openapi.snapshot.json)
bun --filter ./frontend api:generate
```

Font roles live in `frontend/src/styles/typography.css`. `bun --filter ./frontend lint:typography` warns about font choices outside the shared owner without failing the command. The normal lint gate also runs it. Unit tests cover the lint rule's detection logic, not exact fonts, role classes, or rendered sizes.

`bun --filter ./frontend lint:styles` enforces Tailwind's spacing scale in JSX classes, typed recipes, and CSS declarations. It also rejects raw palette utilities, private class selectors, and component `@apply` selector APIs. `bun --filter ./frontend lint:fix` normalizes literal spacing values to that scale. Runtime variables, chart geometry, native state selectors, and calculated layout constraints remain valid.

## Frontend Browser Tests

The browser suite drives the real Go engine over real HTTP. `frontend/playwright.config.ts` starts two servers itself: the `fixtureapi` harness, seeded from `frontend/tests/fixtures/`, and the Vite dev server pointed at it. Each run picks random free ports and a fresh temporary database. It never attaches to a dev server, and several agents can run it at the same time. The harness returns a synthetic user and financial model through the production session contract. It uses no alternate authentication mode in the frontend. No running backend of your own is needed, and none of your data is touched.

```bash
(cd frontend && bunx --no-install playwright install chromium)
bun --filter ./frontend test:browser
```

`test:browser` (the sharding runner) is the entry point. It runs the suite in shards. Each shard starts its own fixture API and Vite server on its own random ports. The default is half the available CPUs, at most four. Set `TEST_BROWSER_SHARDS` to change it. If a port is taken between selection and startup, the shard retries with new ports. Each invocation writes its own blobs under `test-results/run-<pid>/`, so concurrent runs never share trace files. Running `playwright test` directly skips sharding, retry, and output isolation.

Each shard is single-worker because it shares one seeded server. Named spec files run in one shard:

```bash
bun --filter ./frontend test:browser -- financeIndependence.spec.ts accountActivity.spec.ts position.spec.ts
```

The database is fresh for every run, so a schema change never leaves a failing fixture behind.

### Finance independence

`frontend/tests/financeIndependence.spec.ts` rejects forecast requests while
account and transaction lists, recorded activity, and ordinary account details
load. It also verifies saved edits after a forecast failure and local recovery
for explicitly requested projected activity. Existing account-activity tests
retain projected transfers, funding gaps, edits, and keyboard navigation.

```bash
bun --filter ./frontend test:browser -- financeIndependence.spec.ts accountActivity.spec.ts position.spec.ts
```

Backend regressions must distinguish financial validity from forecast readiness.
An invalid forecast evaluation must not block unrelated finance maintenance or
current-position reads. Projections must still reject invalid evaluation inputs,
and financial edits must retain dependent-reference and identity checks.

Receipt upload, image replacement, deletion, review, extraction fallback,
provenance, reload, read-only, keyboard dismissal, and mobile accessibility checks live in
`frontend/tests/receipts.spec.ts`. The mock replaces only extraction. The generated
transport, API, permissions, and SQLite remain real. See
[receipt verification](docs/receipts.md#verification) for scoped checks and the
Nginx upload-limit regression.

Blob adapter conformance and receipt storage failure checks live under
`backend/internal/blobstore/` and `backend/internal/store/`.

To exercise the production build instead of the dev server:

```bash
bun --filter ./frontend build
TEST_PRODUCTION=1 bun --filter ./frontend test:browser
```

## Completion Gate

Agents run the completion gates locally. Hosted CI does not run the test gates.
The Northflank GitHub workflow only requests a gated deployment for the pushed SHA.
The image publisher does not replace the local test gates either. Validate it with
`actionlint .github/workflows/images.yml` and `node --test deploy/images.test.mjs`.

Run the whole gate with one command:

```bash
scripts/test --gate
```

`scripts/test --gate` checks install drift, generates the API client up front,
runs backend, frontend lint, typecheck, unit tests, build, and extension gates in
parallel groups, then runs the browser suite in shards (the runner refreshes
the client again so standalone runs never use a stale tree). Use `--no-browser` for
a fast run and `--shards=N` to control the browser fan-out. `KEEP_GATE_LOGS=1`
keeps the per-group logs for forensics instead of deleting them.

`node scripts/check-install.mjs` compares each workspace `package.json` against
the root `bun.lock` and the installed `node_modules`. It runs in both hooks
and in `scripts/test --unit`. A missing or stale dependency fails here instead
of surfacing later as a typecheck or import error. Install or refresh everything
with `bun install` from the repository root.

For a frontend change, the gate is:

```bash
bun --filter ./frontend lint
bun --filter ./frontend typecheck
bun --filter ./frontend test
bun --filter ./frontend build
bun --filter ./frontend test:browser
```

For a backend change, it is the Go gate below.

The pre-commit hook verifies the backend packages containing staged Go files, plus `oxlint` and `oxfmt --check` on staged frontend files. The pre-push hook verifies `./internal/...` and `./cmd/...`, plus frontend `lint`, `typecheck`, and unit tests, and extension unit tests and lint. Remaining gates (`build`, `test:browser`) run in `scripts/test --gate`.

## Shared Database Isolation

The application stores all users and application identity state in one SQLite
database. Isolation tests must use at least two users in that same physical file,
with identical entity IDs, preset names, and upstream sync keys. Separate fixture
files alone do not prove row-level isolation.

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api/...
```

Test fixtures provision through `store.SetupDatabase` before runtime opens. Startup
regressions verify that missing, empty, and incompatible databases create no files
or schema. Identity initialization must also reject incomplete tables without repair.

Setup creates schemas only for fresh databases. Store regressions verify that
rejected incomplete databases retain identical bytes and permissions.
Cases cover missing receipt/void fields, inline images,
and missing blob lifecycle objects. Repeated setup preserves receipt
links without a backfill.

## Casdoor Authentication

Unit checks need no identity container:

```bash
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/authorization
backend/scripts/verify.sh ./internal/api/...
node --test auth/casdoor/*.test.mjs
```

`scripts/smoke-compose.sh` checks the provisioned guest user on the authenticated stack.
Its viewer grants allow reads and projections on its own data.
Run its request-contract regressions with `node --test scripts/smoke-compose.test.mjs`.
Run the real-Nginx provider-header regression with
`NGINX_TEST_IMAGE=nginx:alpine node --test scripts/nginx-provider.test.mjs`.
The test requires an available local image and Docker. It runs without root
inside the container and checks both the corrected buffer and default-buffer 502.
Without `NGINX_TEST_IMAGE`, it skips the Docker-only test.
Authenticated requests use the user's private data and assert its resource ID.

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
same issuer and user-owned resource IDs. See
[browser address configuration](docs/authentication.md#lan-and-tailnet-browser-addresses).

`auth/test-integration.mjs` checks owner, provisioned guest, and second-user isolation
against a marked disposable Casdoor fixture. `CASDOOR_TEST_MUTATIONS=1` is required.
Its `fixture.json` must identify isolated state under repository `tmp/` or
`/tmp/opencode/`, never live `tmp/dev/`. The script verifies the real permission
API, OIDC, CSRF, restart persistence, private writes, guest projection/SSE,
cross-user rejection, stale resource headers, and logout.
Signup checks include immediate blank-workspace access without administrator
approval or import, first-account editing, page reload, and saved restart persistence.
The provider gate also checks creation-time member/viewer assignment,
application-credential UUID lookup, provider-granted anonymous writes, and
immediate revocation. Unit checks also cover the same path for group-data routes.
`E2E_TEST_MUTATIONS=1 scripts/test --e2e` automates this tier end to end
(disposable provider, real images, real browser, plus share/inbox, group
feed, receipt, migration, and proxy legs). See [the e2e gate](docs/e2e-gate.md).

---

# Backend

## Deployment portability

```bash
backend/scripts/verify.sh ./internal/ingress
go -C backend test ./internal/identity -run TestDeploymentProxy
backend/scripts/verify.sh ./cmd/server
node --test deploy/vercel.test.mjs scripts/smoke-compose.test.mjs
node --test deploy/migrations.test.mjs
docker build -f backend/Dockerfile -t waypoint-deployment-test .
DEPLOYMENT_TEST_IMAGE=waypoint-deployment-test node --test deploy/container.test.mjs deploy/migrations.test.mjs deploy/analysis-migration.test.mjs
```

These checks use disposable state, not the dev stack or production database.
They cover authenticated and Host-preserving HTTP proxies, real API writes,
CSRF denial, incremental streaming, persistent sessions and artifacts, public
probes, command overrides, and a provider-assigned API port. Run the image checks
locally before completion. See [the Vercel guide](deploy/vercel.md) and [the Render/container-host guide](deploy/render.md) for the
Vercel/Render settings, and [the deployment index](deploy/README.md) for the separate actual-provider checklist.

Migration changes also require the [shared SOP](deploy/MIGRATIONS.md) gate on
every supported target. Check actual volume access, nonzero exit propagation,
exact build selection, and API startup only after migration success. The
Northflank workflow and command template live in `deploy/northflank/`.

The verification surface for the backend is its HTTP/SSE contract, CSV seed path, and SQLite persistence.

## Scoped Go Tests

The `internal/api` package composes the router and global HTTP policy. Feature
handlers live in `internal/api/model`, `receipts`, `projections`, and `sync`.
Run `./internal/api/...` to include both feature unit tests and whole-router
contract tests in `internal/api/integration`. Shared fixtures in `apitest`
depend only on storage and domain types, not on the API composition root.

Run the narrowest relevant package first:

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
```

Split settlements (SOC-05) live in the store and settlement suites,
including the race detector over the concurrent retry storm:

```bash
CGO_ENABLED=0 go -C backend test ./internal/store/ ./internal/store/adapters/sqlite/ -run 'Settlement' -count=1
go -C backend test -race ./internal/store/adapters/sqlite/ -run 'TestSettlementConcurrent' -count=1
```

Social-operation audit and idempotency (FND-05) live in the sharing suites,
including the race detector over the concurrent accept storm:

```bash
CGO_ENABLED=0 go -C backend test ./internal/store/adapters/sqlite/ ./internal/sharing/ -run 'Sharing' -count=1
go -C backend test -race ./internal/store/adapters/sqlite/ ./internal/sharing/ -run 'SharingDoubleAccept|SharingConcurrent' -count=1
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
CGO_ENABLED=0 go test ./internal/api/... -run 'TestRowWriteReadOnlyMatrix|TestCORSMiddleware'
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
export RESOURCE_ID=users/your-discovered-resource-id
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
  | jq '{accounts: (.model.accounts | length), postings: (.model.postings | length), checkpoints: (.model.checkpoints | length), issues}'
```

Expected baseline:

- `/healthz` returns `ok`;
- `/v1/status` reports the process configuration;
- the model response returns 200;
- `issues` is an array;
- warning-severity model issues may be present, but a projection must not run with error-severity issues.

`POST /v1/position` accepts `{ "asOfDate": "YYYY-MM-DD", "model": ... }`.
The model is optional and defaults to the scoped stored model. It returns
`result: { asOfDate, netWorth, accounts: [{ accountId, balance }] }` from the same
historical preparation as projections, without a future simulation. It requires
`user:project`, permits projection without write permission, and stores no additional history.
Model/date errors return HTTP 200 with `issues` and `error`, without `result`.

`frontend/tests/position.spec.ts` holds forecast requests open to verify that the
current-position card and evidence work independently. It also checks separate
position/forecast failures and retries. Outlook hides previous-input forecast
placeholders until the active forecast arrives.

## Direct Projection Checks

Choose a projection start on or after the latest checkpoint. The following command derives that date from the stored model:

```bash
START_DATE="$(curl -fsS "$BASE_URL/v1/financial-model" \
  | jq -r '[.model.checkpoints[].observedAt | gmtime | strftime("%Y-%m-%d")] | max // empty')"
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

| Access                                        | User reads/projections                      | Canonical writes and manual sync                  |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Provisioned guest viewer, own resource        | allowed                                     | 401                                               |
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
owner/provisioned-guest/second-user, and logout checks. Go identity tests also check that
bearer headers cannot grant guest access.

The provider gate must also verify creation-time member/viewer assignment,
application-credential UUID lookup, viewer write denial, and permission revocation.
A guest granted an action in the disposable provider must pass the same
runtime enforcement as any other user. No user-kind branch may override that decision.

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
with a writable owner session and its resource assertion
(environment-based mapping overrides are ignored):

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
backend/scripts/verify.sh ./internal/api/...
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
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
CGO_ENABLED=0 go -C backend build ./...
git diff --check
```

For persistence, HTTP policy, SSE, or synchronization changes, also perform the relevant direct checks above against a disposable database and record the observed status codes or event names.
