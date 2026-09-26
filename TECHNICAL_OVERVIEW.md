# Technical Overview: Net Worth Estimator Backend

The backend is the authoritative implementation for model validation, persistence, deterministic simulation, stochastic simulation, and configured evaluations. It exposes one HTTP/SSE contract and stores canonical data, income data, sync-owned rows, and completed projection artifacts in SQLite.

`PRODUCT_INTENT.md` defines the product experience. This document defines only the current Go contracts and domain behavior.

## 1. System Boundary

The runtime has four primary layers:

```text
HTTP/SSE handlers
      ↓
validation and projection orchestration
      ↓
shared domain transitions and evaluation runtime
      ↓
Store interface backed by SQLite
```

- `internal/api` parses HTTP configuration, resolves stored or request-scoped inputs, applies access policy, and serializes results.
- `internal/domain` validates the model, prepares history, executes posting transitions, and runs evaluations.
- `internal/store` owns transactions, ordering, schema migration, row ownership, and artifact eviction.
- `internal/types` defines the JSON and domain values shared across those layers.

The model aggregate is `types.FinancialModelDocument`. Income is stored separately as `types.IncomeDataSnapshot` and is passed into validation and income resolution at request time.

## 2. HTTP Contracts

`api.New(store.Store, api.Config)` constructs the router. `api.Config` contains the normalized origin allowlist, read-only flag, bearer token, optional `simplefin.Runner`, and optional static frontend directory. When `FrontendDir` is set, the router serves built assets and falls back to `index.html` for non-asset GET paths while keeping API, health, docs, and OpenAPI routes reserved. The split container deployment leaves `FrontendDir` empty: the frontend image serves the SPA and proxies `/v1` to the backend.

The container boundary is split. `backend/Dockerfile` produces an API-only image. `frontend/Dockerfile` produces a static Nginx image whose `BACKEND_URL` runtime setting controls the `/v1` proxy. The proxy removes the browser `Origin` header, disables response buffering, and keeps the SSE connection open for long stochastic runs. `docker compose.yml` is the local full-stack composition; the root `Dockerfile` is retained as a legacy combined image for the existing Northflank deployment.

### Canonical model

`GET /v1/financial-model` returns:

```json
{
  "document": "FinancialModelDocument or null",
  "issues": [],
  "revision": "\"sha256-...\""
}
```

Each issue contains `severity`, `code`, `message`, and `path`. Stored model and income rows are loaded in one read transaction. The response always includes a non-null issue array; `document` is null when the store has no canonical model. `revision` and the `ETag` response header identify the canonical content used by conditional writes.

`PUT /v1/financial-model` accepts one `FinancialModelDocument` and requires an `If-Match` header containing the revision returned by the preceding read. It validates the incoming document against the stored income snapshot and returns the same `{document, issues, revision}` shape. A missing `If-Match` value returns 428; a stale value returns 412 without changing stored state.

- Any error-severity issue prevents persistence.
- Warning-only documents are persisted.
- A rejected request does not replace stored state.
- The `source` field on checkpoint and posting inputs is not trusted. The store recomputes ownership.

### Status and income

`GET /v1/status` returns:

```json
{
  "readOnly": false,
  "authEnabled": true
}
```

`GET /v1/income-data` returns `types.IncomeDataSnapshot`, containing effective-dated `incomeSources` and ordered `taxProfiles`.

### Deterministic projection

`POST /v1/projections/deterministic` accepts:

```json
{
  "document": "optional FinancialModelDocument",
  "overrides": {
    "addedAccounts": [],
    "addedPostings": [],
    "disabledAccountIds": [],
    "disabledPostingIds": []
  },
  "settings": {
    "fallbackProjectionStartDate": "YYYY-MM-DD",
    "horizonYears": 1,
    "evaluations": {}
  },
  "incomeData": "optional IncomeDataSnapshot"
}
```

Resolution rules:

- If both `document` and `incomeData` are omitted, one stored snapshot supplies both.
- If only one is supplied, the other comes from storage.
- A supplied document or income snapshot affects only that request.
- `overrides` are applied by `types.ApplyModelOverrides` to a new document value; stored state is unchanged.

A successful response has `result` and `X-Cache: hit|miss`.

A `domain.SimulationPreparationError`, including model validation failure, returns HTTP 200 with `issues`. An unexpected execution error returns HTTP 500 with `error`. Cache read and write failures do not prevent computation.

### Stochastic projection and SSE

`POST /v1/projections/stochastic` accepts the deterministic inputs plus:

```json
{
  "config": {
    "runCount": 100,
    "seed": 42
  }
}
```

`runCount` is normalized to `[1, 10000]`. A null seed requests fresh unseeded draws.

The response is `text/event-stream` with `Cache-Control: no-store`. It writes `retry: 3000` and heartbeat comments every 15 seconds.

| Event | Data |
| --- | --- |
| `progress` | `{ "progress": StochasticProgress }` |
| `partial` | `{ "progress": StochasticProgress, "partial": StochasticProjectionResult }` |
| `result` | `{ "result": StochasticProjectionResult }` |
| `error` | `{ "error": string }` |

A `partial` result is a cumulative snapshot. A slow attached stream may skip intermediate snapshots because the next one supersedes them.

`X-Cache` semantics:

| Value | Meaning |
| --- | --- |
| `hit` | completed seeded result loaded from SQLite; stream contains one `result` event |
| `miss` | this request owns a new seeded run, or an unseeded request-bound run |
| `attach` | this request attached to an identical seeded run already in progress |

An attached seeded request receives the latest cumulative snapshot, if one exists, and then remaining events. A stream disconnect detaches only that stream. The shared seeded computation continues. Completed seeded runs remain in the in-process registry for 60 seconds and in SQLite afterward.

An unseeded run does not use the shared registry or artifact cache. Its context follows the request, so disconnect cancels computation and no result is persisted.

### SimpleFIN trigger

`POST /v1/sync/simplefin` calls `simplefin.Runner.Trigger` and returns `simplefin.Summary` counts.

| Condition | Status |
| --- | --- |
| read-only mode | 403, before bearer validation |
| token configured and missing/wrong | 401 |
| sync unconfigured | 503 |
| another run is active | 409 |
| successful manual run was less than 20 hours ago | 429 |
| success | 200 |

### Origin and write policy

`ParseAllowedOrigins` accepts comma-separated exact HTTP/S origins. It rejects non-root paths, queries, fragments, credentials, invalid ports, empty entries, and wildcard values. CORS permits only `GET`, `POST`, `PUT`, and `OPTIONS`, and only `Content-Type`, `Authorization`, and `If-Match` request headers. Same-origin requests are accepted automatically; configured origins are checked exactly. A TLS-terminating proxy must forward exactly one valid `X-Forwarded-Proto` and `X-Forwarded-Host` value, or have its public HTTPS origin listed in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`.

A request without an `Origin` header passes. Origin filtering does not grant write access.

`writeAuthMiddleware` guards exactly:

- `PUT /v1/financial-model`;
- `POST /v1/sync/simplefin`.

Read-only mode rejects those routes first with 403. Otherwise, a configured token requires the exact `Bearer <token>` value and is compared in constant time. Reads and projection computation remain unguarded.

## 3. Persistence

### Store contract

`store.Store` is the persistence boundary. Its methods cover:

- canonical document load/save, including conditional save by content identity;
- income snapshot load/save;
- one consistent document-and-income load;
- CSV replacement import;
- artifact get/put;
- transactional SimpleFIN application;
- test/import clear and close.

`store.Open` returns the interface, not the SQLite implementation. `RunConformance` exercises that interface for canonical round trips, income effective dating, import rollback, row ownership, sync behavior, dry-run rollback, and artifact first-write behavior.

### SQLite setup

`store.Open(path)` opens the pure-Go SQLite driver and sets:

- WAL journal mode;
- foreign keys;
- a 5-second busy timeout;
- one open connection.

Migrations are transactional and forward-only. A database newer than the supported schema is rejected.

The current schema stores:

| Table | Purpose |
| --- | --- |
| `schema_version` | applied migration versions |
| `model_metadata` | source path and document-present flag |
| `accounts` | ordered account definitions |
| `checkpoints` | ordered balance observations, unique by account/date, with owner |
| `postings` | ordered posting definitions with owner |
| `evaluations` | type, globally keyed instance ID, order, label, enablement, and JSON config |
| `income_sources` | effective-dated income rows sharing an ID |
| `tax_profiles` | ordered deductions, brackets, and source URL |
| `projection_artifacts` | versioned content identity, kind, creation time, and JSON payload |

### First boot and import

`cmd/server` calls `DocumentExists`. When false, `ImportCSV(modelPath, incomePath)` parses both seed directories and replaces model and income state in one transaction. Later server starts read the database and do not rescan seed directories.

`cmd/importcsv` deliberately invokes the same import path for operator-controlled replacement of an existing database.

### Canonical replacement and ownership

`SaveDocument` runs one transaction. `SaveDocumentIfUnchanged` first reads the current canonical content identity inside that transaction and rejects a mismatched ETag before replacing rows.

1. Snapshot stored sync-owned checkpoints and postings.
2. Delete current canonical model rows.
3. Insert incoming owner rows.
4. Re-merge stored sync-owned rows.
5. Persist source metadata.

Incoming `source` values are ignored. Incoming posting IDs in the reserved `sfin-` namespace are dropped. Stored sync rows therefore cannot be forged, edited, or deleted through a model save.

Checkpoint collision rules are explicit:

- an incoming owner checkpoint with the same key and balance preserves the stored sync row;
- an incoming owner checkpoint with the same key and a different balance wins;
- a sync checkpoint with the same key is omitted after an owner override;
- a later synchronization skips the owner-owned key until owner data is removed.

### Artifact durability

Completed deterministic results and completed seeded stochastic results are stored in `projection_artifacts`. The table is bounded to 256 rows across both kinds; the oldest rows are evicted after insertion.

Artifact writes are best-effort. A malformed stored payload is treated as a miss. A store failure fails open and the requested projection is still computed.

The cache is durable only when the SQLite file is durable. A container or service without persistent storage for its database loses canonical edits and artifacts on replacement.

## 4. Artifact Identity

`api.artifactKey` hashes a versioned descriptor with SHA-256. The identity prefix is `<kind>:1:<digest>`.

Deterministic identity includes:

- the resolved model document;
- request overrides;
- fallback projection start date and horizon;
- every enabled evaluation instance ID and config, excluding evaluation labels;
- the resolved income snapshot.

Seeded stochastic identity adds the requested run count and the exact seed.

Consequences:

- omitting model and income bodies still tracks saved model and income changes because the handler hashes the resolved stored snapshot;
- disabled evaluation configs do not affect computation identity;
- evaluation label-only changes do not invalidate a result;
- a seed is part of stochastic identity;
- unseeded stochastic runs are not content-addressed;
- identities are backend-owned and contain no cross-runtime cache compatibility requirement.

## 5. Model Semantics

### Accounts

Accounts are ordered rows with a unique ID, label, bounds, optional color, and enabled flag. Net worth sums only enabled accounts.

- `NoFloor` is `-1e13`.
- `NoCeiling` is `+1e13`.
- A source can withdraw only `max(0, balance - minBalance)`.
- A destination can receive only `max(0, maxBalance - balance)`.
- Bounds are structural constraints, not labels or categories.

### Posting structure

Posting behavior is selected only by source and destination presence:

| Source | Destinations | Behavior |
| --- | --- | --- |
| absent | present | external inflow |
| present | absent | external outflow |
| present | present | account-to-account transfer |

`enabled` controls participation. `priority` controls same-date order. A declaration index breaks priority ties.

`once` executes exactly on `startDate`, whether or not `endDate` is nil or equal to that date. Recurring schedules use 365-day years, 52-week years, and clamped calendar-month/year addition.

### Amount resolution

`PostingAmountResolution` contains a resolver name, resolver config, and exact required inputs. Each input is either a finite literal or a named provider binding.

Current providers:

- `model-value`;
- `posting-latest`;
- `posting-year-to-date`;
- `posting-prior-year-to-date`;
- `account-balance`;
- `occurrence-rate`.

Current general resolvers:

- `expression`;
- `percentage`;
- `progressive-bracket`;
- `capped-percentage`;
- `threshold-percentage`.

`expression` can use posting annual rate, annual growth, and sampled annual volatility. Other resolvers require those posting-level rate fields to be zero.

The `income` resolver is a separate ordered pipeline. It reads the effective income source for the occurrence date, executes configured resolver steps, routes configured outputs, and deposits the remaining net cash into posting destinations. Income posting validation permits at most one enabled income posting, requires destinations, forbids a source account, and forbids a posting annual cap.

### Constraints and movement records

`ResolveAccountMovement` clamps a nonnegative requested amount by:

1. an optional action limit, such as remaining annual cap;
2. positive source withdrawable balance;
3. total destination headroom.

`TransitionRuntime` applies the realized amount and records ordered account deltas. Every movement exposes requested and realized amounts, which is the causal evidence used by fulfillment and financial-independence diagnostics.

Annual-cap usage is observed from realized amounts by posting and calendar year.

## 6. Validation and Preparation

`domain.ValidateFinancialModel` is the authoritative validator. It checks:

- duplicate account, posting, and cross-type evaluation IDs;
- account/posting ID collisions;
- checkpoint account, date, and duplicate key validity;
- amount resolver config, exact required inputs, provider references, and posting dependency cycles;
- posting source/destination references, duplicate destinations, same-account routing, and schedules;
- account bounds;
- evaluation instance IDs and config;
- income references when income data is supplied.

Warnings and errors share the ordered `ModelValidationIssue` shape. `SeverityError` blocks persistence and simulation. `SeverityWarning` does not.

`PrepareSimulationRequest`:

1. applies request overrides without mutating the input document;
2. requires income data when an enabled income posting exists;
3. validates the effective model;
4. validates `fallbackProjectionStartDate`;
5. replays historical state;
6. computes the clamped projection end date;
7. creates one `types.SimulationRequest`.

## 7. Historical Replay and Checkpoints

Historical preparation uses the same `TransitionRuntime` as projection execution.

- Checkpoints after the projection start are invalid.
- Enabled `once` postings before the projection start are replayed.
- A `once` posting on the projection start joins history only when a checkpoint exists that day.
- When the earliest checkpoint exists, recurring occurrences needed between that date and the projection start are replayed.
- Without a start-date checkpoint, projection includes start-date occurrences.
- With a start-date checkpoint, projection excludes start-date occurrences.
- Historical dates execute in ascending calendar order.
- Same-date postings execute by ascending priority, then declaration index.
- Checkpoints execute after same-date postings and overwrite only their account balance.

Each historical correction records observed balance, modeled balance, and adjustment. Historical rows carry no projected movement totals. Replay still updates balances, latest realized posting amounts, and annual-cap state for later projection and amount providers.

`BuildProjectionPath` prefixes these historical observations with projected snapshots. `ProjectionRow.isHistorical` marks the boundary.

## 8. Deterministic Kernel

`Simulate` accepts only a prepared `types.SimulationRequest`. It does not resolve overrides, dates, evaluations, or persistence state.

The kernel:

1. creates a `TransitionRuntime` from the prepared model, state, date, income snapshot, and optional sampled rates;
2. expands enabled occurrences through the projection window;
3. sorts dates and same-date occurrences;
4. executes each occurrence through the shared transition path;
5. records every requested/realized movement and ordered account deltas;
6. snapshots balances after each event date;
7. returns exact initial state, final state, snapshots, movements, and sample metadata.

`BuildProjectionPath` adapts exact results for evaluators. `AdaptSimulationRun` then creates the public `ProjectionResult` by:

- separating historical and projected rows;
- classifying each projected movement structurally;
- computing current and final net worth;
- accumulating external inflow, external outflow, and internal transfer totals;
- rounding public monetary values with `roundCurrency`.

`ProjectFinancialModelDocument` adds the configured evaluation tables.

## 9. Evaluation Runtime

`EvaluationRegistry` contains three process-wide definitions:

| Go definition | Type |
| --- | --- |
| `financialIndependenceDefinition` | `financialIndependence` |
| `netWorthThresholdDefinition` | `netWorthThreshold` |
| `postingFulfillmentDefinition` | `postingFulfillment` |

`types.EvaluationTypeOrder` fixes table order. Each table preserves stored order. Instance IDs are globally unique across all three tables.

`EvaluationRuntimeSet`:

- parses and validates each enabled definition;
- preserves per-instance diagnostics;
- runs deterministic path evaluation;
- prepares stochastic workload reporting;
- creates one accumulator per enabled evaluation;
- consumes one sampled path per run in submission order;
- finalizes probabilistic envelopes;
- returns typed result tables.

An evaluator failure is isolated to that instance as an error diagnostic. Other configured instances continue.

### Financial independence

`EvaluateFinancialIndependence` builds canonical monthly candidate dates. For each candidate it measures net worth, selected annual direct income, selected asset balances, withdrawal capacity, annual expense target, and coverage.

The full principal-preservation cycle uses the generic monthly behavior loop and `TransitionRuntime`:

- selected cashflow sources are observed from the base path;
- only explicitly selected continuing postings execute in the branch;
- monthly expenses are covered by reactive withdrawals;
- withdrawals obey account floors, nonnegative balance, and annual withdrawal limits;
- a cycle fails at the first unresolved expense shortfall;
- principal policy is `allow-drawdown`, `preserve-nominal-principal`, or `preserve-real-principal`;
- summary scans stop at the first successful candidate;
- detailed deterministic output reruns the selected candidate with full withdrawal and balance evidence;
- stochastic output aggregates first-success dates and coverage distributions against required confidence.

Continuing postings are never inferred from IDs, labels, categories, or nonzero rates.

### Net-worth threshold

`EvaluateNetWorthThreshold` scans projected rows only and returns the first date at which net worth reaches the configured target. Stochastic aggregation reports success probability and P10, median, and P90 reached dates across successful sampled outcomes.

### Posting fulfillment

`EvaluatePostingFulfillment` selects all postings when `postingIds` is null, or the configured subset otherwise. It reconstructs pre-event balances, classifies binding constraints, and reports requested, realized, destination-limited, and unfulfilled amounts.

A residual below 0.5 is not reportable. Deterministic output includes first underfulfilled date plus event, date, and posting summaries. Stochastic output reports full-fulfillment probability and unfulfilled-amount percentiles.

## 10. Stochastic Kernel

`StochasticProjection` creates one `stochasticSession` and one prepared baseline request. The session then:

1. prepares and runs the deterministic baseline;
2. evaluates deterministic baseline evaluations in summary mode;
3. counts required annual rates per posting from enabled occurrences and horizon;
4. creates annual-rate samples for each run;
5. simulates sample paths on a worker pool sized to available CPUs;
6. consumes completed paths in submission order;
7. appends rounded net worth values per date;
8. flushes cumulative partial results every 50 completed runs and at completion;
9. feeds each sample path to evaluation accumulators;
10. merges sorted value slices and computes P10/P25/P50/P75/P90.

Samples are created sequentially from one sampler. Worker completion order does not change accumulation order. Percentiles require all configured runs; an interrupted run is not a successful partial result.

The seed controls the state sequence. Run-count normalization and seed-null behavior are part of the artifact and sharing contract.

## 11. SimpleFIN Flow

`internal/simplefin` is configured once in `cmd/server`:

- `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` enables a real Bridge runner.
- `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS` maps Bridge IDs to model account IDs.
- `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS` selects model accounts eligible for pending-charge seeds.
- `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN=1` plans without committing.
- `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK=1` enables fixture mode; an optional fixture file is reloaded for each fetch.
- Fixture mode and a real Access URL are mutually exclusive.
- An invalid account map is fatal at startup.

`Runner.Sync` requests account data for the previous 90 days through tomorrow with pending data included. `Map` emits one balance checkpoint per mapped account/date and only pending negative card charges as disabled `once` postings. Posted, positive, non-USD, invalid-amount, and unmapped rows are counted by reason without logging descriptions or amounts.

`Store.ApplySyncPlan` applies checkpoints and the pending snapshot in one transaction. Owner checkpoints win key collisions. Pending deletion is constrained by owner, account, and the escaped reserved prefix. Dry-run returns before commit, so the transaction rolls back.

The scheduler calls `Runner.Sync` daily at a random minute from 03:00 through 03:59 local time. Manual triggers use `Runner.Trigger`, which rejects concurrent and too-recent successful runs.

## 12. Backend Key Files

| File | Responsibility |
| --- | --- |
| `backend/cmd/server/main.go` | environment, first-boot seed, HTTP lifecycle |
| `backend/cmd/server/sync.go` | SimpleFIN configuration and daily scheduler |
| `backend/cmd/importcsv/main.go` | offline seed replacement |
| `backend/internal/api/server.go` | router and operation registration |
| `backend/internal/api/auth.go` | read-only and bearer policy |
| `backend/internal/api/cors.go` | origin parsing and preflight enforcement |
| `backend/internal/api/model_handlers.go` | model, status, and income handlers |
| `backend/internal/api/projection_handlers.go` | deterministic resolution, execution, and cache |
| `backend/internal/api/stochastic_sse.go` | shared seeded runs and event serialization |
| `backend/internal/api/artifacts.go` | content identity and cache helpers |
| `backend/internal/store/store.go` | `Store`, `store.Open`, migrations |
| `backend/internal/store/model.go` | canonical transaction and ordered reload |
| `backend/internal/store/sync.go` | ownership merge and sync application |
| `backend/internal/store/artifacts.go` | bounded artifact storage |
| `backend/internal/csvio/import.go` | model and income CSV parsing |
| `backend/internal/domain/validation.go` | authoritative model validation |
| `backend/internal/domain/prepare.go` | overrides, history, dates, initial state |
| `backend/internal/domain/transitions.go` | shared movement and income execution |
| `backend/internal/domain/simulate.go` | deterministic kernel |
| `backend/internal/domain/path.go` | path and public-result adaptation |
| `backend/internal/domain/evaluation_runtime.go` | registry and evaluator lifecycle |
| `backend/internal/domain/evaluation_fi.go` | financial-independence branch evaluation |
| `backend/internal/domain/evaluation_threshold.go` | net-worth threshold evaluation |
| `backend/internal/domain/evaluation_fulfillment.go` | posting fulfillment evaluation |
| `backend/internal/domain/stochastic.go` | worker execution and progress |
| `backend/internal/domain/stochastic_session.go` | baseline, samples, percentiles, accumulators |
| `backend/internal/domain/sampler.go` | seeded sampling and percentile helpers |
| `backend/internal/simplefin/runner.go` | fetch/map/apply orchestration and trigger guards |
| `backend/internal/simplefin/map.go` | checkpoint and pending-charge mapping |
