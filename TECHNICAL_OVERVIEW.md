# Technical Overview: Net Worth Estimator Backend

The backend is the authoritative implementation for model validation, persistence, deterministic simulation, stochastic simulation, and configured evaluations. It exposes one HTTP/SSE contract. One shared SQLite application database holds plan-scoped financial data and application identity state.

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

The model aggregate is `types.FinancialModelDocument`. Payroll is modeled as ordinary recurrence rules chained by priority and model-value references: gross pay, pre-tax contributions, employer match, and progressive-bracket tax are separate rules, not a separate income pipeline.

### Shared persistence and ownership

`store.Database` owns the shared connection. Each financial store holds one
immutable plan ID. The plan router creates that scope only after Casdoor verifies
access. `app_accounts` identifies users by immutable issuer and subject. Private
`plans` rows reference their owner. Financial `accounts` remain model entities.

Every financial table includes `plan_id`. Entity IDs and unique names can repeat
between plans. Relational references use composite plan/entity keys. JSON model
references validate against the scoped document. Imports, deletes, ordering,
sync state, default presets, and artifact eviction operate within one plan.

Application sessions, provider grants, and logout records use global identity
tables in the same database. Financial operations never clear those tables.
Casdoor retains its own external provider database. Legacy per-plan files require
[explicit offline migration](docs/shared-database.md).

## 2. HTTP Contracts

`api.New(store.Store, api.Config)` constructs the router. `api.Config` contains the normalized origin allowlist, read-only flag, optional `simplefin.Runner`, and optional static frontend directory. The server always wraps plan APIs with Casdoor-backed session and resource authorization. Only the isolated fixture API omits that boundary. The split container deployment leaves `FrontendDir` empty: the frontend image serves the SPA and proxies `/v1` to the backend.

The container boundary is split. `backend/Dockerfile` produces an API-only image. `frontend/Dockerfile` produces a static Nginx image whose `BACKEND_URL` runtime setting controls the `/v1` proxy. The proxy preserves the browser `Origin` header and keeps stochastic SSE unbuffered. `docker-compose.yml` is the local full-stack composition; the root `Dockerfile` is retained as a legacy combined image.

Frontend and API hosts can differ while the browser uses one public origin.
The runtime's optional `internal/ingress` boundary authenticates a proxy with
`NET_WORTH_ESTIMATOR_PROXY_SECRET` and accepts only configured public origins.
It normalizes Host and scheme before identity, CSRF, and CORS checks. Existing
Host-preserving proxies require no new settings. Runtime `/healthz` and `/readyz`
probes bypass sessions and proxy credentials. Readiness checks the shared database
connection with a two-second deadline. See [the deployment contract](deploy/README.md).

### Canonical model

`GET /v1/financial-model` returns:

```json
{
  "document": "FinancialModelDocument or null",
  "issues": [],
  "revision": "\"sha256-...\""
}
```

Each issue contains `severity`, `code`, `message`, and `path`. The stored model is loaded in one read transaction. The response always includes a non-null issue array; `document` is null when the store has no canonical model. `revision` in the body identifies canonical content for reads and caching.

Row writes apply one change per request. Each `POST`, `PATCH`, or `DELETE` under `/v1/accounts`, `/v1/postings`, `/v1/recurrence-rules`, `/v1/checkpoints`, `/v1/evaluations`, `/v1/payment-terms`, `/v1/amount-presets`, `/v1/pinned-evaluations`, and `/v1/sync/simplefin/accounts` validates the resulting document and returns `{row, issues, persisted, revision}` (or `{deletedId, ...}` / `{revision}` for deletes and moves). Last write wins; there are no preconditions.

- Any error-severity issue prevents persistence.
- Warning-only writes are persisted.
- A rejected request changes nothing.
- The `source` field on checkpoint and posting inputs is not trusted. The store recomputes ownership.
- Omitted row IDs are server-generated UUIDv7, unique across accounts, postings, rules, and evaluations via the `entity_ids` registry (duplicate IDs return 409).
- Positions are server-managed: creates append, `POST .../reorder` moves one row before another (or to the end).

### Status

`GET /v1/status` returns `readOnly`, `syncConfigured`, and `lastSyncAt` (omitted when no sync completed). Session and resource discovery use `/v1/auth/session`.

The frontend displays these provider-neutral sync signals. Provider setup, account linking, and sync execution remain server concerns. The sidebar shows the last successful sync in the viewer's time zone, including read-only mode. Missing status fields mean unknown sync status, not "never synced."

### Deterministic projection

`POST /v1/projections/deterministic` accepts:

```json
{
  "document": "optional FinancialModelDocument",
  "overrides": {
    "addedAccounts": [],
    "addedPostings": [],
    "addedRules": [],
    "disabledAccountIds": [],
    "disabledPostingIds": [],
    "disabledRuleIds": []
  },
  "settings": {
    "fallbackProjectionStartDate": "YYYY-MM-DD",
    "horizonYears": 1,
    "evaluations": {}
  },
  "range": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD"
  }
}
```

Resolution rules:

- If `document` is omitted, the stored model supplies it.
- A supplied document affects only that request.
- `overrides` are applied by `types.ApplyModelOverrides` to a new document value; stored state is unchanged.
- `range` selects response dates inclusively and is required: a missing range fails request validation (422), and an empty, malformed, or inverted range returns 400. Either bound may be omitted for an open end. Only timeline rows and movement events are filtered. Evaluations, totals, summary, milestones, and account summaries retain complete-result values, even for history-only or empty intervals. The simulation receives no response range. The API stores the complete result before response filtering and excludes the range from artifact identity, so requests for different intervals reuse the same artifact.

A successful response has `result` and `Projection-Source: stored|computed`. `stored` means the backend retrieved the identified simulation result. `computed` means this request took the simulation execution path. The header does not guarantee successful completion or storage; preparation and execution errors also report `computed`.

A `domain.SimulationPreparationError`, including model validation failure, returns HTTP 200 with `issues`. An unexpected execution error returns HTTP 500 with `error`. Result-storage read and write failures do not prevent computation.

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

| Event      | Data                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| `progress` | `{ "progress": StochasticProgress }`                                        |
| `partial`  | `{ "progress": StochasticProgress, "partial": StochasticProjectionResult }` |
| `result`   | `{ "result": StochasticProjectionResult }`                                  |
| `error`    | `{ "error": string }`                                                       |

A `partial` result is a cumulative snapshot. A slow attached stream may skip intermediate snapshots because the next one supersedes them.

`Projection-Source` identifies where the result originates:

| Value      | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `stored`   | completed seeded result retrieved from SQLite; stream contains one `result` event |
| `computed` | this request owns a new seeded run or an unseeded request-bound run               |
| `shared`   | this request attaches to an identical seeded run in the shared-run registry       |

`computed` and `shared` streams may end with an `error` event. These values describe execution origin, not successful completion or storage. `Projection-Source` replaces the former `Cache-Status` header for both projection endpoints.

An attached seeded request receives the latest cumulative snapshot, if one exists, and then remaining events. A stream disconnect detaches only that stream. The shared seeded computation continues. Completed seeded runs leave the in-process registry; later reconnects retrieve the identified result from SQLite when available.

An unseeded run does not use the shared registry or result storage. Its context follows the request, so disconnect cancels computation and no result is persisted.

### SimpleFIN trigger

`POST /v1/sync/simplefin` calls `simplefin.Runner.Trigger` and returns `simplefin.Summary` counts.

| Condition                                       | Status |
| ----------------------------------------------- | ------ |
| guest write                                     | 401    |
| denied plan permission or read-only mode        | 403    |
| sync unconfigured                               | 503    |
| another run is active                           | 409    |
| successful manual run was less than 6 hours ago | 429    |
| success                                         | 200    |

### Origin and write policy

`ParseAllowedOrigins` accepts comma-separated exact HTTP/S origins. It rejects non-root paths, queries, fragments, credentials, invalid ports, empty entries, and wildcard values. CORS permits `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, and only `Content-Type` and `Waypoint-Resource` request headers. Same-origin requests are accepted automatically; configured origins are checked exactly. A TLS-terminating proxy must forward exactly one valid `X-Forwarded-Proto` and `X-Forwarded-Host` value, or have its public HTTPS origin listed in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`.

A request without an `Origin` header passes. Origin filtering does not grant write access.

The identity boundary checks session and plan permissions for all plan reads, writes, and projections. `readOnlyMiddleware` adds the global write kill switch:

- `POST`, `PATCH`, `DELETE` under `/v1/accounts`, `/v1/postings`, `/v1/recurrence-rules`, `/v1/checkpoints`, `/v1/evaluations`, `/v1/payment-terms`;
- `POST /v1/sync/simplefin` and link writes under `/v1/sync/simplefin/accounts`.

The kill switch rejects those writes with 403. Guests can read and project only the separate sample. Shared bearer tokens and unauthenticated server startup are unsupported in dev and production. The server rejects the retired `AUTH_TOKEN` setting before opening financial storage.

## 3. Persistence

### Store contract

`store.Store` is the persistence boundary. Its methods cover:

- canonical document load (writes go through row create/update/delete/move);
- row writes with server-generated UUIDv7 IDs and a shared cross-table ID registry;
- bridge-to-model account links;
- CSV replacement import;
- artifact get/put;
- transactional SimpleFIN application with provisioning;
- test/import clear and close.

`Database.Plan` returns the scoped interface, not the SQLite implementation. `RunConformance` exercises that interface for row round trips, ID-registry conflicts, ownership, link behavior, sync provisioning, import rollback, and artifact first-write behavior. `store.Open` remains an isolated fixture helper, not the runtime constructor.

### SQLite setup

`store.SetupDatabase(path)` owns explicit deployment schema setup. `cmd/setupdb`
creates its private parent directory. Migration and fixture provisioning also call
this setup constructor explicitly. Setup includes every identity table and index
and selects WAL journal mode.

`store.OpenDatabase(path)` requires an existing complete schema. It opens the
pure-Go SQLite driver with `mode=rw` and sets:

- foreign keys;
- a 5-second busy timeout;
- one open connection.

Runtime startup creates no database directories, database files, tables, or
indexes. It validates schema compatibility and fails closed if setup is absent.
Identity initialization also validates its tables without DDL. SQLite can create
normal WAL/SHM sidecars during operation.

Schema changes are transactional and forward-only. Completed upgrades are recorded
in `schema_migrations`. Legacy unscoped databases require explicit offline migration.
Restore a database backup before a downgrade.

The current schema stores:

| Table                    | Purpose                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `sessions`               | global application sessions with hashed tokens, opaque data, and expiry                                       |
| `identity_grants`        | global provider grants and token credentials, bound to issuer and subject                                     |
| `identity_logout_marks`  | global revocation markers that block delayed callbacks and stale grants                                       |
| `identity_logout_tokens` | global signed logout token replay records                                                                     |
| `app_accounts`           | verified application account identities, unique by issuer and subject                                         |
| `plans`                  | private owner relationship or explicitly published guest sample                                               |
| `model_metadata`         | source path and document-present flag                                                                         |
| `accounts`               | ordered account definitions                                                                                   |
| `checkpoints`            | ordered balance observations, unique by account/date, with owner                                              |
| `postings`               | ordered UUID posting definitions with owner and explicit pending state                                        |
| `purchase_policies`      | plan-scoped purchase priorities attached to posting identities                                                |
| `recurrence_rules`       | ordered repetition templates with schedule, priority, and optional annual cap                                 |
| `payment_terms`          | mechanism config for debt-account minimums, due anchors, and statement anchors                                |
| `evaluations`            | type, plan-scoped instance ID, order, label, enablement, and JSON config                                      |
| `entity_ids`             | shared ID registry across accounts, postings, rules, and evaluations                                          |
| `account_links`          | bridge-to-model bindings with snapshot, origin, and last-seen date                                            |
| `pinned_evaluations`     | ordered pinned evaluation instance IDs                                                                        |
| `safe_spending_settings` | plan-scoped safe-spending preferences                                                                         |
| `sync_state`             | last successful sync completion time                                                                          |
| `projection_artifacts`   | versioned content identity, kind, creation time, and JSON payload                                             |
| `amount_presets`         | ordered saved amount recipes (stable name, label, summary, amount descriptor), seeded with 8 factory defaults |
| `posting_sync_keys`      | exact provider/account/transaction identity mapped to a local posting UUID                                    |
| `posting_id_migrations`  | private old-to-new posting identity audit for the one-way UUID migration                                      |
| `schema_migrations`      | completed transactional schema upgrades                                                                       |

### First boot and import

The authenticated plan router initializes a blank private plan on first authorized access. It never adopts legacy data. `ImportCSV` (offline tool, fixture seeding, tests) parses the model CSV directory and replaces the selected plan's model state in one transaction.

`cmd/importcsv` requires both an existing shared database and an explicit existing plan resource ID. It invokes the same import path for operator-controlled replacement within that plan.

### Row writes and ownership

Each row write runs one transaction: validate the resulting document, then insert, replace, delete, or reorder one row. There is no whole-document replace at runtime; `replaceDocument` survives only as the private seed/import path.

1. Creates claim the row ID in `entity_ids` (server-generated UUIDv7 when omitted); duplicates return 409.
2. Updates replace one owner row by ID; deletes remove it; moves rewrite positions.
3. Posting IDs are canonical UUIDs. Incoming `source` and `pending` values are ignored and recomputed. Stored ownership protects sync rows from owner updates and deletes. ID prefixes carry no policy or lifecycle meaning.
4. Owner checkpoints win key collisions; a later synchronization skips the owner-owned key until owner data is removed.
5. Deleting an account keeps its bridge links; the link is the memory of the mapping, so recreating the account resumes sync flow. A link whose model account is gone resolves to nothing and is counted as `linked-account-missing` until relinked.

### Amount presets

Amount presets are saved amount recipes managed through `GET /v1/amount-presets`, `POST`/`PATCH`/`DELETE /v1/amount-presets`, and `POST /v1/amount-presets/reorder`. Each write runs one transaction without touching the canonical document: creates generate UUIDv7 IDs when omitted; names are unique (duplicates return 409) and immutable; deletes and moves return the affected ID. Validation is shape-only (non-empty name and label, `ValidateAmountDescriptor` with no references so placeholder IDs pass); failures return issues with `persisted: false`. The table seeds 8 factory presets at migration time and survives `Clear` and CSV import: presets are user configuration, not model data.

### Posting identity upgrade

The previous release's single-plan upgrade converts every
non-UUID posting ID, rewrites amount/evaluation/preset references, preserves row
display order, equal-time execution order, and purchase policies, and removes derived simulation results. Account
and recurrence-rule IDs remain unchanged. The shared database importer requires
that compatible source schema. Upgrade older backups with the previous release
before the offline shared migration. See [the migration contract](docs/posting-identity.md).

### Artifact durability

Completed deterministic results and completed seeded stochastic results are stored in `projection_artifacts`. Each plan retains at most 256 rows across both kinds. Insertion evicts only that plan's oldest rows.

Result writes are best-effort. A malformed stored payload is unavailable for retrieval. A storage failure does not prevent the requested simulation from execution.

Stored simulation results are durable only when the SQLite file is durable. A container or service without persistent storage for its database loses canonical edits and results on replacement.

## 4. Artifact Identity

`api.artifactKey` hashes a versioned descriptor with SHA-256. The identity format is `<kind>:<artifactIdentityVersion>:<digest>`. The serialized envelope retains the legacy `artifactCacheVersion` field name to preserve existing identities.

Deterministic identity includes:

- the resolved model document;
- request overrides;
- fallback projection start date and horizon;
- every enabled settings evaluation instance ID and config, excluding settings evaluation labels. The complete model document also contributes its evaluation tables.

Seeded stochastic identity adds the requested run count and the exact seed.

Consequences:

- omitting the model body still tracks saved model changes because the handler hashes the resolved stored snapshot;
- disabled settings evaluation configs do not affect result identity, but model-document changes still do;
- settings evaluation label-only changes do not change result identity, but model-document renames do;
- a seed is part of stochastic identity;
- unseeded stochastic runs are not content-addressed;
- result identities are backend-owned and have no cross-runtime compatibility requirement.

## 5. Model Semantics

### Accounts

Accounts are ordered rows with a unique ID, label, bounds, optional color, and enabled flag. Net worth sums only enabled accounts.

- `NoFloor` is `-1e13`.
- `NoCeiling` is `+1e13`.
- A source can withdraw only `max(0, balance - minBalance)`.
- A destination can receive only `max(0, maxBalance - balance)`.
- Bounds are structural constraints, not labels or categories.

### Posting and recurrence-rule structure

Postings are single timed movements: one record of money moved, carrying
posted time (when the bank posts it) and transaction time (when the money
moves), both Unix seconds. Repetition is owned by recurrence rules, which
expand into occurrences at projection time. A posting with a `claim`
(`ruleId` plus `occurrenceDate`, both set manually) records the actual for
one scheduled occurrence; history replays the actual and skips the generated
occurrence.

Posting and rule behavior is selected only by source and destination presence:

| Source  | Destinations | Behavior                    |
| ------- | ------------ | --------------------------- |
| absent  | present      | external inflow             |
| present | absent       | external outflow            |
| present | present      | account-to-account transfer |

`enabled` controls participation. One-time postings carry posted and
transaction Unix times and always execute before scheduled rule
occurrences on the same day, ordered by transaction time, then posted
time, then ID. Rules carry `priority`, which orders rule occurrences
after all one-time postings on the same day; declaration sequence breaks
priority ties.

A rule occurrence executes exactly on its scheduled date. Schedules use 365-day years, 52-week years, and clamped calendar-month/year addition.

### Amount resolution

`PostingAmountResolution` contains a resolver name, resolver config, and exact required inputs. Each input is either a finite literal or a named provider binding.

Current providers:

- `model-value`;
- `account-balance`;
- `occurrence-rate`;
- `growth-factor`;
- `terms-minimum`;
- `late-fee`;
- `balance-fee`.

Current general resolvers:

- `expression`;
- `progressive-bracket` (progressive tax liability on gross minus pre-tax contributions minus deduction).

`expression` amounts carry rate behavior in their inputs: the `occurrence-rate` provider resolves the annual rate (sampled per projection year when volatile) divided by the frequency divisor, and the `growth-factor` provider resolves the compounding factor from the rule start date. One-time and recurring movements resolve through the same path. Posting references (`model-value`) may name posting or rule IDs; a rule reference resolves to its latest realized occurrence. Payroll chains rules by priority and `model-value`: gross pay, pre-tax contributions, employer match, and a `progressive-bracket` tax rule compose take-home pay from ordinary movements.

Layman discovery: `GET /v1/amount-resolvers` returns `resolvers` and `providers` as wiring only (entry names, technical descriptions, field keys, field kinds, required flags, and provider volatility). All human words live in the frontend. Reusable recipes persist as rows: `GET /v1/amount-presets` lists them, `POST`/`PATCH`/`DELETE /v1/amount-presets` and `POST /v1/amount-presets/reorder` manage them. A preset is an authoring macro only — applying it copies its amount descriptor into a posting or rule, so simulation never reads presets and they never affect artifact identity. The wire shape is unchanged; presets only author it.

### Constraints and movement records

`ResolveAccountMovement` clamps a nonnegative requested amount by:

1. an optional action limit, such as remaining annual cap;
2. positive source withdrawable balance;
3. total destination headroom.

`TransitionRuntime` applies the realized amount and records ordered account deltas. Every movement exposes requested and realized amounts, which is the causal evidence used by fulfillment and financial-independence diagnostics.

Annual-cap usage is observed from realized amounts by movement ID (posting or rule) and calendar year. Caps live on rules only; a claimed actual accrues under its own posting ID, matching how one-time postings behaved before rules existed.

## 6. Validation and Preparation

`domain.ValidateFinancialModel` is the authoritative validator. It checks:

- duplicate account, posting, rule, and cross-type evaluation IDs;
- account/posting/rule ID collisions (one shared namespace);
- checkpoint account, date, and duplicate key validity;
- amount resolver config, exact required inputs, provider references, and movement dependency cycles spanning postings and rules;
- posting and rule source/destination references, duplicate destinations, same-account routing, rule schedules, and claim validity (named rule exists, date is a real scheduled occurrence, no double claims);
- account bounds;
- evaluation instance IDs and config.

Warnings and errors share the ordered `ModelValidationIssue` shape. `SeverityError` blocks persistence and simulation. `SeverityWarning` does not.

`PrepareSimulationRequest`:

1. applies request overrides without mutating the input document;
2. validates the effective model;
3. validates `fallbackProjectionStartDate`;
4. replays historical state;
5. computes the clamped projection end date;
6. creates one `types.SimulationRequest`.

## 7. Historical Replay and Checkpoints

Historical preparation uses the same `TransitionRuntime` as projection execution.

- Checkpoints after the projection start are invalid.
- Enabled postings dated before the projection start are replayed.
- A posting dated on the projection start joins history only when a checkpoint exists that day.
- When the earliest checkpoint exists, rule occurrences needed between that date and the projection start are replayed, except occurrences claimed by a manual posting.
- Without a start-date checkpoint, projection includes start-date occurrences.
- With a start-date checkpoint, projection excludes start-date occurrences.
- Historical dates execute in ascending calendar order.
- Same-date movements execute one-time postings first (by transaction time, posted time, then ID), then rule occurrences by ascending priority and resolution sequence.
- Checkpoints execute after same-date postings and overwrite only their account balance.

Each historical correction records observed balance, modeled balance, and adjustment. Historical rows carry no projected movement totals. Replay still updates balances, latest realized posting amounts, and annual-cap state for later projection and amount providers.

`BuildProjectionPath` prefixes these historical observations with projected snapshots. `ProjectionRow.isHistorical` marks the boundary.

## 8. Deterministic Kernel

`Simulate` accepts only a prepared `types.SimulationRequest`. It does not resolve overrides, dates, evaluations, or persistence state.

The kernel:

1. creates a `TransitionRuntime` from the prepared model, state, date, and optional sampled rates;
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

`EvaluationRegistry` contains five process-wide definitions:

| Go definition                     | Type                    |
| --------------------------------- | ----------------------- |
| `financialIndependenceDefinition` | `financialIndependence` |
| `netWorthThresholdDefinition`     | `netWorthThreshold`     |
| `accountBalanceDefinition`        | `accountBalance`        |
| `postingFulfillmentDefinition`    | `postingFulfillment`    |
| `cycleFulfillmentDefinition`      | `cycleFulfillment`      |

`types.EvaluationTypeOrder` fixes table order. Each table preserves stored order. Instance IDs are globally unique across all tables.

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

Posting fulfillment and public transaction evidence share the per-event assessment in `evaluateMovementEvents`. Public `movementEvents[].fulfillment` reports unfulfilled and destination-limited amounts, including the canonical reportable threshold and rounding. Funding gaps and Safe spending consume these amounts rather than classify failures themselves. This evidence remains available when configured fulfillment evaluations are absent, disabled, or limited to selected transactions. The Funding gaps account-history ledger explains the result; it does not determine fundability.

Outlook renders only saved evaluation pins, using the same compact evaluation card components as the Evaluations page. Net-worth and account-balance targets have no automatic preview or fallback selection. Funding gaps has no separate always-visible panel. Pins control Outlook visibility; unpinning does not disable an evaluation. Threshold cards show the first-crossing date, current amount, target, and scenario result directly, without an evidence dialog. The shared Funding gaps card's cash-flow inspector follows the evaluation's configured transaction selection.

### Financial independence

`EvaluateFinancialIndependence` builds canonical monthly candidate dates. For each candidate it measures net worth, selected annual direct income, selected asset balances, withdrawal capacity, annual expense target, and coverage.

The full principal-preservation cycle uses the generic monthly behavior loop and `TransitionRuntime`:

- selected cashflow sources are observed from the base path;
- only explicitly selected continuing movements (postings or rules) execute in the branch;
- monthly expenses are covered by reactive withdrawals;
- withdrawals obey account floors, nonnegative balance, and annual withdrawal limits;
- a cycle fails at the first unresolved expense shortfall;
- principal policy is `allow-drawdown`, `preserve-nominal-principal`, or `preserve-real-principal`;
- summary scans stop at the first successful candidate;
- detailed deterministic output reruns the selected candidate with full withdrawal and balance evidence;
- stochastic output aggregates first-success dates and coverage distributions against required confidence.

Continuing movements are never inferred from IDs, labels, categories, or nonzero rates.

### Net-worth threshold

`EvaluateNetWorthThreshold` scans projected rows only and returns the first date at which net worth reaches the configured target. Stochastic aggregation reports success probability and P10, median, and P90 reached dates across successful sampled outcomes.

### Posting fulfillment

`EvaluatePostingFulfillment` selects all postings when `postingIds` is null, or the configured subset otherwise. It reconstructs pre-event balances, classifies binding constraints, and reports requested, realized, destination-limited, and unfulfilled amounts.

A residual below 0.5 is not reportable. Deterministic output includes first underfulfilled date plus event, date, and posting summaries. Stochastic output reports full-fulfillment probability and unfulfilled-amount percentiles.

## 10. Stochastic Kernel

`StochasticProjection` creates one `stochasticSession` and one prepared baseline request. The session then:

1. prepares and runs the deterministic baseline;
2. evaluates deterministic baseline evaluations in summary mode;
3. counts required annual rates per volatile amount from enabled occurrences and horizon;
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

- The Bridge key is connected per plan through `POST /v1/sync/simplefin/credential` and stored in `sync_credentials`. The old `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` and `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS` environment variables are retired.
- Account links live in the `account_links` table.
- Card selection is stored per plan in `sync_credentials` and selects model accounts eligible for pending-charge seeds.
- Bridge accounts with no link are auto-provisioned as model accounts (investment when holdings are reported, cash otherwise) with an `auto` link; `GET /v1/sync/simplefin/accounts` lists links and snapshots for user relinking, `PUT`/`DELETE` manage them. Disaster recovery is a database backup: links live in `account_links` beside the data.
- A bridge account that vanishes keeps its link, rows, and data (stale, never deleted by sync).

`Runner.Sync` requests account data for the previous 90 days through tomorrow with pending data included. It resolves bridge accounts through stored links, provisions unmapped USD accounts, then `Map` emits one balance checkpoint per resolved account/date and only pending negative card charges as disabled postings. Posted, positive, non-USD, and invalid-amount rows are counted by reason without logging descriptions or amounts.

`Store.ApplySyncPlan` applies checkpoints and the pending snapshot in one transaction. Owner checkpoints win key collisions. Exact provider/account/transaction keys map to store-allocated UUIDs. Repeated snapshots update those same rows. Only absent rows with the matching provider, model account, and explicit pending state are deleted. Summary counters distinguish `pendingInserted`, `pendingUpdated`, and `pendingDeleted`.

The scheduler calls `Runner.Sync` every 6 hours at the next 6-hour boundary (00, 06, 12, 18 local) plus a random minute offset. Manual triggers use `Runner.Trigger`, which rejects concurrent and too-recent successful runs. Successful runs persist their completion time; `GET /v1/status` exposes it as `lastSyncAt` alongside `syncConfigured`.

## 12. Backend Key Files

| File                                                | Responsibility                                          |
| --------------------------------------------------- | ------------------------------------------------------- |
| `backend/cmd/server/main.go`                        | environment, first-boot seed, HTTP lifecycle            |
| `backend/cmd/server/sync.go`                        | SimpleFIN configuration and 6-hour scheduler            |
| `backend/cmd/importcsv/main.go`                     | offline seed replacement                                |
| `backend/internal/api/server.go`                    | router and operation registration                       |
| `backend/internal/api/auth.go`                      | read-only write kill switch                             |
| `backend/internal/api/cors.go`                      | origin parsing and preflight enforcement                |
| `backend/internal/api/model_handlers.go`            | model and status handlers                               |
| `backend/internal/api/rows.go`                      | row create/update/delete/move and link handlers         |
| `backend/internal/api/projection_handlers.go`       | deterministic resolution, execution, and result storage |
| `backend/internal/api/stochastic_sse.go`            | shared seeded runs and event serialization              |
| `backend/internal/api/artifacts.go`                 | simulation result identity and storage helpers          |
| `backend/internal/store/store.go`, `database.go`    | scoped `Store`, shared `Database`, schema lifecycle     |
| `backend/internal/store/model.go`                   | seed/import replacement and ordered reload              |
| `backend/internal/store/rows.go`                    | row CRUD, ID registry, links, provisioning              |
| `backend/internal/store/sync.go`                    | sync application and pending snapshot                   |
| `backend/internal/store/artifacts.go`               | bounded artifact storage                                |
| `backend/internal/csvio/import.go`                  | canonical model CSV parsing                             |
| `backend/internal/domain/validation.go`             | authoritative model validation                          |
| `backend/internal/domain/prepare.go`                | overrides, history, dates, initial state                |
| `backend/internal/domain/transitions.go`            | shared movement execution                               |
| `backend/internal/domain/simulate.go`               | deterministic kernel                                    |
| `backend/internal/domain/path.go`                   | path and public-result adaptation                       |
| `backend/internal/domain/evaluation_runtime.go`     | registry and evaluator lifecycle                        |
| `backend/internal/domain/evaluation_fi.go`          | financial-independence branch evaluation                |
| `backend/internal/domain/evaluation_threshold.go`   | net-worth threshold evaluation                          |
| `backend/internal/domain/evaluation_fulfillment.go` | posting fulfillment evaluation                          |
| `backend/internal/domain/stochastic.go`             | worker execution and progress                           |
| `backend/internal/domain/stochastic_session.go`     | baseline, samples, percentiles, accumulators            |
| `backend/internal/domain/sampler.go`                | seeded sampling and percentile helpers                  |
| `backend/internal/simplefin/runner.go`              | fetch/map/apply orchestration and trigger guards        |
| `backend/internal/simplefin/map.go`                 | checkpoint and pending-charge mapping                   |
