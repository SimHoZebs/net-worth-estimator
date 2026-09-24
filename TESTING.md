# Backend Testing

The verification surface for this checkout is the Go backend, its HTTP/SSE contract, CSV seed path, and SQLite persistence. No application implementation exists outside this backend.

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

Run the repository-wide diagnostic only to expose copy-only or tooling failures:

```bash
backend/scripts/verify.sh
```

In this checkout, the no-argument command reaches `backend/scripts/bench-template_test.go`. That file currently stops `go vet` with an undefined `ProjectFinancialModelDocument` in the scripts directory. CI and hooks exclude that template and use the production-package commands above.

Direct commands are useful while diagnosing a failure:

```bash
cd backend
CGO_ENABLED=0 go test ./internal/domain/... -run 'TestGolden'
CGO_ENABLED=0 go test ./internal/api -run 'TestPutAuthMatrix|TestCORSMiddleware'
CGO_ENABLED=0 go test ./internal/store -run 'TestStoreConformance|TestPurgeSyncScriptClearsSyncRows'
CGO_ENABLED=0 go build ./...
```

In an environment with the race detector's supported CGO toolchain, CI runs the production packages:

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

Use a disposable database. From the repository root, start the server with absolute seed paths:

```bash
export BASE_URL=http://127.0.0.1:8787
export NET_WORTH_ESTIMATOR_DB=/tmp/net-worth-estimator-test.db
export NET_WORTH_ESTIMATOR_MODEL_PATH="$PWD/public/configs"
export NET_WORTH_ESTIMATOR_INCOME_PATH="$PWD/public/data/income"
unset NET_WORTH_ESTIMATOR_READ_ONLY
unset NET_WORTH_ESTIMATOR_AUTH_TOKEN

CGO_ENABLED=0 go -C backend run ./cmd/server
```

The first start imports the real seed directories. A later start reads SQLite and does not rescan those directories. To start from a clean seed snapshot, remove only the disposable database and its `-shm`/`-wal` companions while the server is stopped.

The defaults bind to `127.0.0.1:8787`. Set `HOST=0.0.0.0` only when another process must reach the listener.

## Direct Read Checks

Run these in another terminal:

```bash
curl -fsS "$BASE_URL/healthz"
printf '\n'

curl -fsS "$BASE_URL/v1/status" | jq .
curl -fsS "$BASE_URL/v1/financial-model" \
  | jq '{accounts: (.document.accounts | length), postings: (.document.postings | length), checkpoints: (.document.checkpoints | length), issues}'
curl -fsS "$BASE_URL/v1/income-data" \
  | jq '{incomeSources: (.incomeSources | length), taxProfiles: (.taxProfiles | length)}'
```

Expected baseline:

- `/healthz` returns `ok`;
- `/v1/status` reports the process configuration;
- the model and income responses return 200;
- `issues` is an array;
- warning-severity model issues may be present, but a projection must not run with error-severity issues.

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
  }
}' > /tmp/deterministic-request.json

curl -fsS -D /tmp/deterministic-headers \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/deterministic-request.json \
  "$BASE_URL/v1/projections/deterministic" \
  | jq '{hasResult: (.result != null), issueCount: (.issues | length // 0), error}'

grep '^X-Cache:' /tmp/deterministic-headers
```

Run the same request again. The second response should normally report `X-Cache: hit` when artifact persistence is available.

Seeded stochastic request:

```bash
jq '. + {config: {runCount: 20, seed: 42}}' \
  /tmp/deterministic-request.json > /tmp/stochastic-request.json

curl -fsS -N -D /tmp/stochastic-headers \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/stochastic-request.json \
  "$BASE_URL/v1/projections/stochastic" \
  | tee /tmp/stochastic-events.sse

grep '^X-Cache:' /tmp/stochastic-headers
grep '^event:' /tmp/stochastic-events.sse
```

A small seeded run should terminate with one `result` event. It may include `progress` and `partial` events. Repeating the same request should produce `X-Cache: hit` and one `result` event. Sending `"seed": null` exercises the request-bound path; disconnecting that stream cancels its work and must not create an artifact.

## Read-Only and Bearer Matrix

Exercise each row against a disposable database and record the status and whether stored state changed.

| Mode | Authorization | `PUT /v1/financial-model` | `POST /v1/sync/simplefin` |
| --- | --- | --- | --- |
| writable, no token configured | absent | normal handling | 503 when sync is unconfigured |
| writable, token configured | absent | 401 | 401 |
| writable, token configured | wrong bearer | 401 | 401 |
| writable, token configured | correct bearer | normal handling | normal handling or sync-specific error |
| read-only, no token | absent | 403 | 403 |
| read-only, token configured | correct bearer | 403 | 403 |
| either mode | any | `GET` remains 200 | reads and projections remain 200 |

Read-only server:

```bash
export NET_WORTH_ESTIMATOR_READ_ONLY=1
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Bearer server:

```bash
unset NET_WORTH_ESTIMATOR_READ_ONLY
export NET_WORTH_ESTIMATOR_AUTH_TOKEN=test-token-123
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Save a model payload, then compare the three requests:

```bash
curl -fsS "$BASE_URL/v1/financial-model" \
  | jq '.document' > /tmp/model.json

curl -sS -o /tmp/no-token.json -w '%{http_code}\n' \
  -X PUT -H 'Content-Type: application/json' \
  --data-binary @/tmp/model.json \
  "$BASE_URL/v1/financial-model"

curl -sS -o /tmp/wrong-token.json -w '%{http_code}\n' \
  -X PUT -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong' \
  --data-binary @/tmp/model.json \
  "$BASE_URL/v1/financial-model"

curl -sS -o /tmp/valid-token.json -w '%{http_code}\n' \
  -X PUT -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test-token-123' \
  --data-binary @/tmp/model.json \
  "$BASE_URL/v1/financial-model"
```

Expected statuses are 401, 401, and 200. Repeat with `NET_WORTH_ESTIMATOR_READ_ONLY=1` and the valid token; expected status is 403. After every rejected save, reload the model and confirm it is unchanged.

Use a cryptographically random token outside this disposable test setup. Store production values in a secret manager and serve guarded endpoints only through encrypted transport.

## CORS Checks

Start with an exact allowlist:

```bash
export NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS=https://app.example.com
unset NET_WORTH_ESTIMATOR_READ_ONLY
unset NET_WORTH_ESTIMATOR_AUTH_TOKEN
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Allowed preflight with bearer support:

```bash
curl -sS -o /dev/null -D - -X OPTIONS \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: Content-Type, Authorization' \
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

For local fixture verification, set exact dry-run and fixture mode:

```bash
export NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK=1
export NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS=mock-checking=checking,mock-prime=prime_card
export NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS=prime_card
export NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN=1
unset NET_WORTH_ESTIMATOR_AUTH_TOKEN
CGO_ENABLED=0 go -C backend run ./cmd/server
```

With writable, unauthenticated access, trigger and inspect counts:

```bash
curl -fsS -X POST "$BASE_URL/v1/sync/simplefin" | jq .
```

The response must report `dryRun: true`. Reload the model and confirm no `simplefin` rows were committed. A second successful trigger inside 20 hours returns 429; the interval guard stamps successful runs only.

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

Use it only against a writable instance without bearer enforcement and with SimpleFIN configured. For read-only, bearer, CORS, or unconfigured-sync behavior, use the direct checks above so the expected status is explicit.

## Completion Gate

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
