# Testing

This checkout holds the Go backend in `backend/`, the Waypoint frontend in `frontend/`, and the purchase-capture extension in `extension/`. Each has its own gates. The backend is the calculation authority; the frontend renders its results and saves each row through its editor. Failed edits stay local to the form for retry, and multi-row imports apply per row without an atomic whole-model promise.

Use `./scripts/test` as the single entry point:

```bash
scripts/test --unit          # package/config checks; no pre-existing stack or credentials
scripts/test --integration   # browser integration suite (fixture API and frontend server over real HTTP)
scripts/test --all           # unit then integration
scripts/test --matrix        # dataset-pack x identity-set edge matrix (see docs/integration-edge-gates.md)
E2E_TEST_MUTATIONS=1 scripts/test --e2e  # disposable end-to-end gate
```

Unit tests run without application servers. Package and configuration tests may create disposable local HTTP listeners. Browser integration owns its servers and database. None of these commands needs the dev stack.

| Layer | Entry point | Location | Boots |
| --- | --- | --- | --- |
| Unit | `scripts/test --unit`, `bun --filter ./frontend test:unit` | Frontend, Go, provider, script and deployment contracts | Disposable package fixtures; no Docker daemon |
| Integration | `scripts/test --integration`, `bun --filter ./frontend test:integration` | `frontend/tests/integration/*.spec.ts` | Fixture API and frontend server over HTTP |
| E2E | `E2E_TEST_MUTATIONS=1 scripts/test --e2e` | `auth/test-e2e.mjs` | Real provider and images |

The root aliases are `bun run test:unit`, `bun run test:integration`, and `E2E_TEST_MUTATIONS=1 bun run test:e2e`. The e2e alias keeps the deliberate disposable-run confirmation.

Unit includes the Go verify script, frontend unit tests, Better Auth provider tests with disposable databases, and `scripts/test-contracts` for configuration, script, E2E contract, and host migration safety suites. Host migration checks need Go and sqlite3. Run the whole unit file list, not only a new test. Integration boots real HTTP servers. E2E exercises real provider and deployment images against disposable state. Physical passkeys, external recovery delivery, and production mutations remain manual. `--all` covers tests, not the lint, typecheck, and build gates.

The purchase-capture extension adds `bun --filter ./extension test` to unit and `bun --filter ./extension test:browser` to integration. Its completion gate also runs `bun --filter ./extension lint` and `bun --filter ./extension build`. See [extension setup and verification](extension/README.md).

Standalone planned-purchase CRUD and user isolation run in the API/store suites. The one-time upgrade script has its own tests under `backend/scripts/one-time/planned-purchases/`, included in the backend gate. See [purchase persistence](docs/purchase-queue.md#persistence).

Gate rules and tier details live in [release gates](docs/release-gates.md), [integration edge gates](docs/integration-edge-gates.md), [the e2e gate](docs/e2e-gate.md), [shared database](docs/shared-database.md), [authentication](docs/authentication.md), and [receipts](docs/receipts.md#verification).

## Local development

For manual UI exploration, use synthetic data without a production snapshot or identity setup:

```bash
bun install --frozen-lockfile
bun --filter ./frontend api:generate
(cd frontend && bunx --no-install playwright install chromium)
./dev/main.mjs demo --pack safe-spending
```

The demo uses the browser fixture harness and stops with Ctrl-C. Snapshot-backed development with production images is optional and owned by [dev/README.md](dev/README.md). Its `refresh-db` command replaces only the dev financial database from a consistent production snapshot.

Dev setup checks: `node --test dev/*.test.mjs`. Provider checks: `bun --filter @waypoint/auth test`. Configuration checks require the Docker Compose CLI, but no running daemon.

Parallel agents use isolated slots instead of stopping the canonical stack or stealing its ports:

```bash
./dev/main.mjs setup --slot shots
docker compose --env-file .env.dev.shots -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev.shots -f docker-compose.dev.yml down
./dev/main.mjs ps-all
```

State lives in `tmp/dev-<slot>/`, the env file is `.env.dev.<slot>`, and the Compose project is `waypoint-dev-<slot>`. Slots are loopback-only; `--tailnet` stays on the canonical stack.

## Frontend gates

Run from the repository root:

```bash
bun install --frozen-lockfile
bun --filter ./frontend lint
bun --filter ./frontend typecheck
bun --filter ./frontend test:unit
bun --filter ./frontend build
```

Generate the API client before running frontend scripts directly: `bun --filter ./frontend api:generate`.

Refresh the checked-in OpenAPI snapshot without a running server or financial data:

```bash
bun --filter ./frontend openapi:refresh
```

Run the routing regression specs with:

```bash
bun --filter ./frontend test:integration -- modalUrls.spec.ts workspace.spec.ts groupSharing.spec.ts safeSpending.spec.ts
```

## Integration suite

The integration suite drives the real Go engine over real HTTP. It starts its own fixture API, seeded from a fixture pack, and frontend server. Each run picks random free ports and a fresh temporary database; several agents can run it concurrently.

```bash
(cd frontend && bunx --no-install playwright install chromium)
bun --filter ./frontend test:integration
```

`test:integration` is the sharding runner. It defaults to half the available CPUs, at most four; set `TEST_BROWSER_SHARDS` to change it. CI gives each of four Playwright shards its own runner. Pass an explicit shard with `bun --filter ./frontend test:integration -- --shard=N/4`. Each invocation writes its own blobs under `test-results/run-<pid>/` and merges them into one HTML report; parse the per-shard `results.json` for exact locators. The suite fixes `locale: en-US` and `timezoneId: America/Los_Angeles` and fails on unexpected console errors or uncaught exceptions.

Run named specs in one shard:

```bash
bun --filter ./frontend test:integration -- financeIndependence.spec.ts accountActivity.spec.ts position.spec.ts
```

`financeIndependence.spec.ts` verifies that an invalid forecast does not block account lists, recorded activity, or ordinary maintenance. `receipts.spec.ts` covers upload, replacement, deletion, review, extraction fallback, provenance, read-only, keyboard dismissal, and mobile accessibility with only extraction mocked. See [receipt verification](docs/receipts.md#verification). Blob adapter and storage failure checks live under `backend/internal/blobstore/` and `backend/internal/store/`.

To exercise the production build:

```bash
bun --filter ./frontend build
TEST_PRODUCTION=1 bun --filter ./frontend test:integration
```

## Completion gate

Agents run the narrowest local check, push the branch, and watch hosted `Tests` for the exact commit. Completion and release requirements live in [release gates](docs/release-gates.md). For an optional local aggregate:

```bash
scripts/test --gate
```

That command checks install drift, generates the API client, runs backend, frontend, provider, extension, and shared contract groups, then runs both browser suites. Use `--no-browser` to skip browsers, `--shards=N` to control frontend fan-out, and `KEEP_GATE_LOGS=1` for logs. Hosted Tests additionally verifies the income sidecar, Northflank deployment image, and Python payment-pattern upgrade. The local aggregate does not reproduce those jobs. The pre-commit hook checks install drift and formatting only; it runs no tests. See [integration edge gates](docs/integration-edge-gates.md) for the matrix.

`node scripts/check-install.mjs` compares each workspace `package.json` against the root `bun.lock` and installed `node_modules`. Install or refresh everything with `bun install` from the repository root.

## Shared database isolation

Isolation tests must use at least two users in the same physical SQLite file, with identical entity IDs, preset names, and upstream sync keys. Separate fixture files alone do not prove row-level isolation.

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api/...
```

Test fixtures provision through `store.SetupDatabase` before runtime opens. Setup creates schemas only for fresh databases; rejected incomplete databases retain identical bytes and permissions. See [shared database](docs/shared-database.md).

## Identity and end-to-end

Unit checks need no identity container:

```bash
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/authorization
backend/scripts/verify.sh ./internal/api/...
bun --filter @waypoint/auth typecheck
bun --filter @waypoint/auth test
```

`scripts/smoke-compose.sh` checks the provisioned guest user on the authenticated stack; its viewer grants allow reads and projections on its own data. Run its request-contract regressions with `node --test scripts/smoke-compose.test.mjs`, and the real-Nginx provider-header regression with `NGINX_TEST_IMAGE=nginx:alpine node --test scripts/nginx-provider.test.mjs` (Docker required; it skips without the image). See [the authentication guide](auth/README.md) for provider setup and offline recovery.

`E2E_TEST_MUTATIONS=1 scripts/test --e2e` runs the disposable end-to-end gate against real images and a real browser: owner, provisioned guest, and second-user isolation; OIDC, CSRF, restart persistence, private writes, guest projection/SSE, cross-user rejection, stale resource headers, logout, provider grants and revocation, plus share/inbox, group feed, receipt, migration, and proxy legs. See [the e2e gate](docs/e2e-gate.md). Physical passkeys and phone recovery use the [manual checklist](docs/authentication.md#manual-physical-device-and-recovery-checklist).

Browser-origin identity checks:

```bash
go -C backend test ./internal/identity -run 'TestBrowser|TestProviderAlias|TestProviderProxy|TestSiblingApp'
```

See [browser address configuration](docs/authentication.md#browser-addresses).

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

These checks use disposable state, not the dev stack or production database. They cover authenticated and Host-preserving HTTP proxies, real API writes, CSRF denial, incremental streaming, persistent sessions and artifacts, public probes, command overrides, and a provider-assigned API port. See [the Vercel guide](deploy/vercel.md), [the Render/container-host guide](deploy/render.md), and [the deployment index](deploy/README.md). Migration changes also require the [shared SOP](deploy/MIGRATIONS.md) gate on every supported target.

## Scoped Go tests

`backend/scripts/verify.sh` sets `CGO_ENABLED=0` and runs gofmt, go vet, and go test. Run the narrowest relevant package first:

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
```

Run the repository-wide gate to catch cross-package breakage:

```bash
backend/scripts/verify.sh
```

Direct commands are useful while diagnosing a failure:

```bash
cd backend
CGO_ENABLED=0 go test ./internal/domain/... -run 'TestGolden'
CGO_ENABLED=0 go test ./internal/api/... -run 'TestRowWriteReadOnlyMatrix|TestCORSMiddleware'
CGO_ENABLED=0 go test ./internal/store/... -run 'TestStoreConformance|TestPurgeSyncScriptClearsSyncRows'
CGO_ENABLED=0 go build ./...
```

Race-detector suites for concurrent settlement and sharing retries:

```bash
go -C backend test -race ./internal/store/adapters/sqlite/ -run 'TestSettlementConcurrent' -count=1
go -C backend test -race ./internal/store/adapters/sqlite/ ./internal/sharing/ -run 'SharingDoubleAccept|SharingConcurrent' -count=1
```

Run the production packages with the race detector where the CGO toolchain supports it:

```bash
go -C backend test -race ./internal/... ./cmd/...
```

Benchmark one complete projection:

```bash
backend/scripts/bench-sim.sh deterministic
backend/scripts/bench-sim.sh checkpoints
```

## Real-data server

These optional recipes investigate data-specific problems. They are not routine completion requirements. Use a disposable database restored from a backup. Configure Better Auth, Casbin, and the verified primary-data owner through [the auth guide](auth/README.md). The server requires the same session configuration in dev and production. Use a SQLite-safe snapshot or stop the source before a file copy.

```bash
export COOKIE_FILE=/path/to/private/disposable-cookie-jar
export RESOURCE_ID=users/your-discovered-resource-id
export PUBLIC_ORIGIN=http://localhost:8080
export BASE_URL=http://127.0.0.1:8787
export NET_WORTH_ESTIMATOR_DB=$PWD/tmp/net-worth-estimator-test.db
unset NET_WORTH_ESTIMATOR_READ_ONLY

curl() {
  command curl --cookie "$COOKIE_FILE" \
    -H "Waypoint-Resource: $RESOURCE_ID" -H "Origin: $PUBLIC_ORIGIN" "$@"
}

cp <backup>.db tmp/net-worth-estimator-test.db
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Direct API snippets require the session cookie file, discovered resource ID, and configured public origin. The server reads the restored database and never scans seed directories. The defaults bind to `127.0.0.1:8787`; set `HOST=0.0.0.0` only when another process must reach the listener. The CORS checks below use plain `curl` without this authenticated helper.

### Read checks

In another terminal:

```bash
curl -fsS "$BASE_URL/healthz"
curl -fsS "$BASE_URL/v1/status" | jq .
curl -fsS "$BASE_URL/v1/financial-model" \
  | jq '{accounts: (.model.accounts | length), transactions: (.model.transactions | length), checkpoints: (.model.checkpoints | length), issues}'
```

Expect `/healthz` to return `ok`; `/v1/status` to report `readOnly`, `hasModel`, `syncConfigured`, `syncHost`, `syncQuotaUsed`, `syncQuotaLimit`, `lastSyncAt` when present, and `syncError` when present; the model response to return 200 with an array `issues`. Warning-severity issues may be present, but a projection must not run with error-severity issues.

`POST /v1/position` accepts `{ "asOfDate": "YYYY-MM-DD", "model": ... }`. The model is optional and defaults to the scoped stored model. It returns `result: { asOfDate, netWorth, accounts: [{ accountId, balance }] }` from historical preparation without a future simulation. It requires `user:project`, permits projection without write permission, and stores no additional history. Model or date errors return HTTP 200 with `issues` and `error`, without `result`.

### Projection checks

Choose a projection start on or after the latest checkpoint:

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
      transactionFulfillment: []
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

A deterministic request always reports `Projection-Source: computed`.

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

A small seeded run terminates with one `result` event and may include `progress` and `partial` events. A request that owns its seeded run reports `computed`; attachment to an existing shared run reports `shared`. Sending `"seed": null` exercises the request-bound path; disconnecting that stream cancels its work and stores no result.

### Session and read-only matrix

Exercise each row through the real identity boundary against disposable state:

| Access | User reads/projections | Canonical writes and manual sync |
| --- | --- | --- |
| Provisioned guest viewer, own resource | allowed | 401 |
| Signed-in owner, own resource | allowed | allowed, subject to validation/sync configuration |
| Signed-in owner, another resource | 409 for stale resource assertion | rejected |
| Owner without write permission | allowed when read/project permissions exist | 403 |
| Owner with global read-only enabled | allowed | 403 |
| Provider unavailable when verification is due | 503 | 503 |

A shared Authorization bearer header cannot replace a session or bypass a denied permission. `AUTH_TOKEN` and `AUTH_PROVIDER=none` cause server startup to fail. After each rejected write, confirm financial data stays unchanged. Row validation can return 200 with error-severity issues and `saved: false`. The provider gate must verify creation-time member/viewer assignment, application-credential UUID lookup, viewer write denial, and permission revocation. A guest granted an action in the disposable provider must pass the same runtime enforcement as any other user; no user-kind branch may override that decision.

### CORS checks

Start with an exact allowlist:

```bash
export NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS=https://app.example.com
unset NET_WORTH_ESTIMATOR_READ_ONLY
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Allowed preflight returns 204:

```bash
curl -sS -o /dev/null -D - -X OPTIONS \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: Content-Type, Waypoint-Resource' \
  "$BASE_URL/v1/financial-model"
```

Disallowed origin returns 403:

```bash
curl -sS -o /tmp/disallowed-origin.txt -w '%{http_code}\n' \
  -H 'Origin: https://other.example.com' \
  "$BASE_URL/v1/financial-model"
```

A request without an origin to `/healthz` returns 200:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL/healthz"
```

Verify unsupported preflight methods and request headers are rejected.

## SimpleFIN Checks

For live Bridge verification, connect a key through the credential endpoint with a writable owner session and its resource assertion (environment-based mapping overrides are ignored):

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

The response reports `checkpointsInserted`, `pendingInserted`, and `accountsProvisioned`. Link a bridge account to a model account through `PUT /v1/sync/simplefin/accounts/{bridgeAccountId}` and list links with `GET` on the same path. `bridgeAccountId` is the connection-scoped key `sf2.<conn_id>.<account_id>`. Restart the server to clear the in-memory trigger stamp, trigger again, and confirm checkpoints resolve to the linked accounts. A second successful trigger inside the configured interval (default 6 hours) returns 429; the guard stamps successful runs only. When the Bridge reports `available-balance`, the account balance row exposes `availableBalance` separately from the posted `balance`.

Guard tests belong in Go:

```bash
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/api/...
```

## Smoke script

`scripts/smoke-backend.sh` performs health and model-summary requests and checks the SimpleFIN credential endpoint. It skips `POST /v1/sync/simplefin` because a trigger needs a connected key:

```bash
BASE_URL=http://127.0.0.1:8787 scripts/smoke-backend.sh
```

Supply `COOKIE_FILE`, `RESOURCE_ID`, and `PUBLIC_ORIGIN` for an authorized owner. Use a disposable writable instance. For read-only, session, CORS, or unconfigured-sync behavior, use direct checks with explicit expected statuses.

## Backend completion gate

Run the narrowest relevant [scoped Go check](#scoped-go-tests) locally. Hosted Tests runs the complete backend suite. Follow [release gates](docs/release-gates.md) for completion; add direct disposable-state checks only when a changed boundary lacks automated coverage, and record that gap and its observed result.
