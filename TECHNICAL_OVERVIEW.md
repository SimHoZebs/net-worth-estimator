# Technical Overview: Net Worth Estimator Backend

Rendered architecture visuals live in `docs/diagrams/` (Mermaid sources plus Pele-generated SVGs, combined in `docs/diagrams/index.html`).

The backend owns financial records, validation, persistence, historical current position, evidence Analysis, and optional deterministic and stochastic simulation with configured evaluations. It exposes one HTTP/SSE contract. One shared SQLite application database holds user-scoped financial data and application identity state.

`PRODUCT_INTENT.md` defines the product experience. This document defines the current Go contracts and domain behavior. Where the schema, OpenAPI, or a test already expresses a rule, this document defers to it instead of restating it.

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
- `internal/domain` validates the model, prepares history, executes transaction transitions, and runs evaluations.
- `internal/store` owns transactions, ordering, schema migration, row ownership, and projection caches.
- `internal/types` defines the JSON and domain values shared across those layers.

The model aggregate is `types.FinancialModel`. Payroll is modeled as ordinary recurrence rules chained by priority and model-value references: gross pay, pre-tax contributions, employer match, and progressive-bracket tax are separate rules, not a separate income pipeline.

### Finance and forecast lifecycles

Financial records are authoritative inputs. A projection consumes those inputs;
it does not control account maintenance or access to recorded activity.

- Account and transaction reads do not execute future simulation.
- Current position shares chronological replay with the projection baseline.
  Shared replay preserves the observed-versus-modeled balance contract without
  requiring a forecast result.
- Financial validation and forecast-evaluation validation have separate owners.
  Financial edits preserve legitimate references, while an unrelated invalid
  forecast configuration does not block maintenance.
- Simulation preparation retains complete input validation. Projection and
  evaluation errors stay with their requesting components.
- The frontend's recorded account activity and ordinary transaction lists do
  not request a forecast. Selecting projected activity requests its own result
  and exposes its own loading, error, and retry state.
- Record lists show stored literal amounts. Formula-based planned amounts stay
  `Varies` until a component explicitly requests their calculated outcome;
  the browser does not duplicate backend amount resolution.
- Evidence Analysis remains independent of sync and projection execution.

This boundary uses the existing tables. It does not change account participation,
balance constraints, stored amount descriptors, or historical replay arithmetic.
Future transaction search and subscription Analysis can consume financial
records without a new dependency on projection execution.

### Shared persistence and ownership

Receipt evidence has its own account-scoped storage and a provider-neutral extraction
interface. Images and metadata never enter `FinancialModel` or projection
identity. See [receipt contracts and source adapters](docs/receipts.md).
Background Analysis also owns separate evidence and findings. Its worker runs
independently of bank sync and never creates recurrence rules or changes financial
rows. See [Analysis lifecycle, persistence, and BNPL detection](docs/analyses.md).
Image bytes also have a separate blob storage port (`backend/internal/blobstore`,
with SQLite and filesystem adapters, private references, and durable cleanup
in `backend/internal/store/adapters/sqlite/blob_storage.go`).

`store.Database` owns the shared connection. Each financial store holds one
immutable user ID. The user router creates that scope only after Casbin verifies
access. `users` identifies users by immutable issuer and subject. Financial
`accounts` remain model entities.

Every financial table includes `user_id`. Entity IDs and unique names can repeat
between users. Relational references use composite user/entity keys. JSON model
references validate against the scoped model. Imports, deletes, ordering,
sync state, default presets, and projection caches operate within one user.

Application sessions, provider grants, and logout records use global identity
tables in the same database. Financial operations never clear those tables.
Better Auth retains its own external provider database. Embedded Casbin reads
the separate application-owned policy database for every decision.

## 2. HTTP Contracts

`internal/api` is the composition root. It owns chi, Huma configuration, global
read-only and origin policy, and server status. The `model`,
`receipts`, `projections`, and `sync` subpackages register operations through
explicit dependencies. They do not import the composition root or each other.
`api/internal/modelstate` owns the revision and storage-error HTTP contracts
shared by model writes and account links. Projection state and SSE fan-out
stay within `projections`, with the shared-run registry separate from transport.
Whole-router HTTP contracts live in `api/integration`; private helper tests
stay with their feature package.

`api.New(store.Store, api.Config)` constructs the router. `api.Config` contains the normalized origin allowlist, read-only flag, and optional `simplefin.Runner`. The server wraps user APIs with Better Auth OIDC sessions and embedded Casbin authorization. Only the isolated fixture API omits that boundary. The frontend image serves the SPA and proxies `/v1` to the backend.

The container boundary is split. `backend/Dockerfile` produces the default API-only image and an explicit `northflank` target that adds the Python/River sidecar and supervisor. `frontend/Dockerfile` produces a static Nginx image whose `BACKEND_URL` runtime setting controls the `/v1` proxy. The proxy preserves the browser `Origin` header and keeps stochastic SSE unbuffered. `docker-compose.yml` is the local full-stack composition.

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
  "model": "FinancialModel or null",
  "issues": [],
  "revision": "\"sha256-...\""
}
```

Each issue contains `severity`, `code`, `message`, and `path`. The stored model is loaded in one read transaction. The response always includes a non-null issue array; `model` is null when the store has no canonical model. `revision` in the body identifies canonical content for reads and caching.

Row writes apply one change per request. Each `POST`, `PATCH`, or `DELETE` under `/v1/accounts`, `/v1/transactions`, `/v1/schedules`, `/v1/checkpoints`, `/v1/evaluations`, `/v1/payment-terms`, `/v1/amount-presets`, `/v1/pinned-evaluations`, `/v1/planned-purchases`, `/v1/safe-spending-settings`, and `/v1/sync/simplefin/accounts` validates the resulting model and returns `{value, issues, saved, revision}` (or `{deletedId, ...}` / `{revision}` for deletes and moves). Last write wins; there are no preconditions. Receipt evidence (`/v1/receipts...`, `/v1/transactions/{id}/receipts`) and Analysis feedback (`/v1/analysis-findings...`, `/v1/analysis-feedback`) mutate their own stores with the same one-change-per-request shape; per-route details live in [receipts](docs/receipts.md), [Analysis](docs/analyses.md), and the [purchase queue](docs/purchase-queue.md).

- Error-severity issues from the write's validation boundary prevent persistence.
  Ordinary finance writes validate financial records and protect existing valid
  evaluation references. Evaluation writes validate the complete model.
  Preexisting unrelated forecast errors remain diagnostics on the model read.
- Warning-only writes are saved.
- A rejected request changes nothing.
- The `source` field on checkpoint and transaction inputs is not trusted. The store recomputes ownership.
- Omitted row IDs are server-generated UUIDv7, unique across accounts, transactions, rules, and evaluations via the `entity_ids` registry (duplicate IDs return 409).
- Positions are server-managed: creates append, `POST .../reorder` moves one row before another (or to the end).

### Status

`GET /v1/status` exposes server capabilities and sync state. The OpenAPI snapshot defines the full field set; `hasModel` is a cheap presence check, not a model read. Session and resource discovery use `/v1/auth/session`.

The frontend displays these provider-neutral sync signals. Provider setup and raw account-link management remain server concerns. Sync execution also stays server-side. The only user-facing mapping action retires one manual account in favor of the synced account already linked to a bridge account. The sidebar shows the last successful sync in the viewer's time zone, including read-only mode. Missing status fields mean unknown sync status, not "never synced."

### Deterministic projection

`POST /v1/projections/deterministic` accepts:

```json
{
  "model": "optional FinancialModel",
  "overrides": {
    "addedAccounts": [],
    "addedTransactions": [],
    "addedRules": [],
    "disabledAccountIds": [],
    "disabledTransactionIds": [],
    "disabledRuleIds": []
  },
  "settings": {
    "fallbackProjectionStartDate": "YYYY-MM-DD",
    "horizonYears": 1,
    "evaluations": {},
    "asOfInstant": null
  },
  "range": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD"
  }
}
```

Resolution rules:

- Production omits `model` and `overrides`; the stored model supplies the base.
- A supplied model affects only that request and exists for tests, fixtures, and offline tooling.
- `overrides` are applied by `types.ApplyModelOverrides` to a new model value; stored state is unchanged.
- What-if scenarios do not use base overrides. They run as `whatIf` simulator evaluations with inline added, disabled, and modified copies.
- `range` selects response dates inclusively and is required: a missing range fails request validation (422), and an empty, malformed, or inverted range returns 400. Either bound may be omitted for an open end. Only timeline rows and transaction events are filtered. Evaluations, totals, summary, milestones, and account summaries retain complete-result values, even for history-only or empty intervals. The simulation receives no response range. Every request computes the complete result directly; the range only filters the response.
- `settings.asOfInstant` is an optional exact cut (Unix seconds) refining the start date: history replays through the instant, the start day's afternoon events simulate, and replayed morning occurrences are suppressed by identity so nothing executes twice. It must fall on the start date; omitted means the calendar-day end cut at the end of the start day.
- `POST /v1/position` and `GET /v1/accounts/balances` accept the same cut as an `asOfDate` date or RFC 3339 instant (`asOf` query); all three agree at an identical cut because they share one chronological replay.

A successful response has `result` and `Projection-Source: computed`. Canonical requests assemble from stored rows when the state is clean and the settings plus evaluation tables match the built state; otherwise the request builds once and assembles, or computes directly for non-canonical inputs. The header does not guarantee successful completion; preparation and execution errors also report `computed`.

A `domain.SimulationPreparationError`, including model validation failure, returns HTTP 200 with `issues`. An unexpected execution error returns HTTP 500 with `error`.

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

The operation belongs to Huma's compute group. Huma decodes its JSON input and returns problem-JSON errors before the stream starts: an empty body returns 400, malformed JSON returns 422, and an unavailable model returns 500. Domain preparation failures remain SSE `error` events. `huma.StreamResponse` sets source headers before it commits the stream; the higher-level SSE helper commits too early for this endpoint's source selection. The operation preserves its existing unrestricted body size and domain-owned model validation.

The response is `text/event-stream` with `Cache-Control: no-store`. It writes `retry: 3000` and heartbeat comments every 15 seconds.

| Event      | Data                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| `progress` | `{ "progress": StochasticProgress }`                                        |
| `partial`  | `{ "progress": StochasticProgress, "partial": StochasticProjectionResult }` |
| `result`   | `{ "result": StochasticProjectionResult }`                                  |
| `error`    | `{ "error": string }`                                                       |

A `partial` result is a cumulative snapshot. A slow attached stream may skip intermediate snapshots because the next one supersedes them.

`Projection-Source` identifies where the result originates:

| Value      | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `computed` | this request owns a new seeded run or an unseeded request-bound run         |
| `shared`   | this request attaches to an identical seeded run in the shared-run registry |

`computed` and `shared` streams may end with an `error` event. These values describe execution origin, not successful completion. `Projection-Source` replaces the former `Cache-Status` header for both projection endpoints.

Canonical seeded requests assemble from stored statistics when the state is clean and the run count, frozen seed, and evaluation tables match. A miss builds once per user: trials run with the frozen seed, statistics and outputs persist, then the stream serves one `result` event. A stream disconnect detaches only that stream. Completed seeded builds leave the in-process registry; later identical requests assemble from stored rows. Result durability across restarts arrives with slice persistence.

An unseeded run never uses stored rows. Its context follows the request, so disconnect cancels computation.

### SimpleFIN trigger

`POST /v1/sync/simplefin` calls `simplefin.Runner.Trigger` and returns `simplefin.Summary` counts.

| Condition                                       | Status |
| ----------------------------------------------- | ------ |
| denied action without interactive sign-in       | 401    |
| denied user permission or read-only mode        | 403    |
| sync unconfigured                               | 503    |
| another run is active                           | 409    |
| successful manual run was less than 6 hours ago | 429    |
| success                                         | 200    |

### Origin and write policy

`ParseAllowedOrigins` accepts comma-separated exact HTTP/S origins. It rejects non-root paths, queries, fragments, credentials, invalid ports, empty entries, and wildcard values. CORS permits `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, and only `Content-Type` and `Waypoint-Resource` request headers. Same-origin requests are accepted automatically; configured origins are checked exactly. A TLS-terminating proxy must forward exactly one valid `X-Forwarded-Proto` and `X-Forwarded-Host` value, or have its public HTTPS origin listed in `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`.

A request without an `Origin` header passes. Origin filtering does not grant write access.

The identity boundary checks session and user permissions for all user reads, writes, and projections. Huma's `readOnlyMiddleware` adds the global write kill switch before input parsing. Matched operations other than `GET`, `HEAD`, and `OPTIONS` are writes by default. The compute group marks position and projection operations with compute metadata so they remain available in read-only mode. Domain route groups share one Huma API and OpenAPI document. Receipt upload limits run as operation middleware after the write guard.

The kill switch rejects writes with 403 without a separate endpoint list. The provisioned guest's viewer membership grants read and projection actions on its own user resource. Every user uses the same permission enforcement. Shared bearer tokens and unauthenticated server modes are unsupported in dev and production.

## 3. Persistence

### Store contract

`store.Store` is the persistence boundary. Its methods cover:

- canonical model load (writes go through row create/update/delete/move);
- row writes with server-generated UUIDv7 IDs and a shared cross-table ID registry;
- projection state, slices, rows, generated facts, statistics, and evaluation outputs;
- bridge-to-model account links;
- model replacement import;
- transactional SimpleFIN application with provisioning;
- test/import clear and close.

`Database.User` returns the scoped interface, not the SQLite implementation. `RunConformance` exercises that interface for row round trips, ID-registry conflicts, ownership, link behavior, sync provisioning, and import rollback. `store.Open` remains an isolated fixture helper, not the runtime constructor.

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

Setup creates the complete schema only in a fresh database. Existing databases
must already have the current schema. Setup never converts data or repairs
missing schema objects. Separate one-time operator scripts own version upgrades.
Restore a compatible backup instead of
downgrading.

Timestamped observations use the one-time offline body in `deploy/migrate.sh`.
The deployment adapter runs `/app/migrate.sh` from the target image with all
API writers stopped and the actual data mount attached. The image's SQLite
CLI converts each legacy date to 23:59:59 UTC and drops the date column.
The body validates the source state and creates a private SQLite-safe backup.
It converts a disposable candidate, applies the frozen Analysis SQL, invokes
the standalone purchase conversion tool, and removes completed transaction-ID audit
bookkeeping there. The audit remains in the verified backup. `setupdb` only validates the
finished schema. The body verifies preserved rows,
integrity, and foreign keys before publication. Complete target databases
only verify on retries. Fresh databases use `SetupDatabase` before the hook.
The server and setup never invoke the migration. See `deploy/MIGRATIONS.md`.

The store's schema definition is authoritative for tables, columns, and indexes. This document owns the persistence contract around it, not a table inventory.

### First boot and import

Planned purchases use dedicated `/v1/planned-purchases` CRUD and reorder routes.
See [purchase persistence](docs/purchase-queue.md#persistence).

The authenticated user router initializes a blank private workspace on first authorized access. `ImportModel` replaces the selected user's model state in one transaction and is used by fixture packs and tests. At runtime the populated database is authoritative: no seed file replaces canonical state. Production replacement uses a database backup and restore.

### Row writes and ownership

Each row write validates the resulting state at its finance or evaluation boundary, then inserts, replaces, deletes, or reorders one row. There is no whole-model replace at runtime; `replaceModel` survives only as the model replacement path used by fixture packs and tests. Creates use the new row's instant and checkpoints use their instant; updates, deletes, moves, schedule starts and endings, claims, accounts, and payment terms dirty from projection start with no preceding read, so an early date is never missed. Account moves (position order only), evaluation writes, pins, presets, links, and safe-spending settings do not dirty. Generated `projected` rows carry a slice id and never appear in model, sync, or analysis reads; every one of those reads filters them by null slice.

1. Creates claim the row ID in `entity_ids` (server-generated UUIDv7 when omitted); duplicates return 409.
2. Updates replace one owner row by ID; deletes remove it; moves rewrite positions.
3. Transaction IDs are canonical UUIDs. Incoming `source`, `pending`, and `void` values are ignored and recomputed. Stored lifecycle treats every bank row as owner-editable; the owner may clear pending or void to settle or restore it, and the sync may set pending or void on arrival. ID prefixes carry no policy or lifecycle meaning.
4. Owner checkpoints win same-instant key collisions (several observations per account/day survive); a later synchronization skips the owner-owned instant until owner data is removed, retains backdated instants as their own rows, and replaces a same-instant sync row idempotently. Databases that predate the required instant fail schema validation; the server never migrates them.
5. Deleting an account keeps its bridge links; the link is the memory of the mapping, so recreating the account resumes sync flow. A link whose model account is gone resolves to nothing and is counted as `linked-account-missing` until relinked.

### Amount presets

Amount presets are saved amount recipes managed through `GET /v1/amount-presets`, `POST`/`PATCH`/`DELETE /v1/amount-presets`, and `POST /v1/amount-presets/reorder`. Each write runs one transaction without touching the canonical model: creates generate UUIDv7 IDs when omitted; names are unique (duplicates return 409) and immutable; deletes and moves return the affected ID. Validation is shape-only (non-empty name and label, `ValidateAmountDescriptor` with no references so placeholder IDs pass); failures return issues with `saved: false`. The table seeds 8 factory presets at migration time and survives `Clear` and model replacement: presets are user configuration, not model data.

### Transaction identity

Persisted transactions use canonical UUIDs; the store generates UUIDv7 IDs when the
caller supplies none. Sources with non-UUID transaction IDs are unsupported. Exact upstream `(provider, account_id, transaction_id)` identity
lives in `transaction_sync_keys`, separate from local transaction IDs (see
`transactionSyncKey` in `backend/internal/store/sync_pending.go`).

### Result durability

Slices, generated rows, statistics, and evaluation outputs persist in
`projection_states`, `projection_slices`, `projection_rows`,
`monte_carlo_statistics`, and the typed output tables (see
`backend/internal/types/projection_unified.go` and
`backend/internal/store/adapters/sqlite/schema.go`). Canonical edits are
durable only when the SQLite file is durable. A container or service without
persistent storage for its database loses canonical edits on replacement.
The `Projection-Source` header stays `computed` or `shared`; it does not
carry a stored marker. See [unified projection](docs/unified-projection.md)
for slice lifecycle, revision validity, and canonical bypass rules.

### Split settlements

Payoff against shared-expense obligations (SOC-05,
`backend/internal/store/settlement.go`,
`backend/internal/store/adapters/sqlite/settlements.go`, store-level
only) is an append-only ledger kept separate from balances:
`RecordSettlement` writes one `split_settlements` row plus one
`split_settlement_requests` idempotency row and never touches
transactions, checkpoints, accounts, or balances, so recording a
settlement moves no money. Each record names one split, the
participant whose obligation it reduces, a positive integer-minor-unit
amount, and an optional link to one real payment; one real payment
backs at most one settlement, so linked payments are never
double-counted. Retries reuse a client-generated UUID request ID per
(actor, key): replays return the recorded settlement, concurrent
identical retries converge to one row, and a key reused for a
different settlement fails with `store.ErrSettlementConflict`.
Outstanding, partially-settled, and settled states are derived, never
stored: `SummarizeSettlements` combines caller-supplied owed shares
with the recorded history (each row counted once), and
`SplitSettlementState` rolls the positions into one split state.
Split-membership fencing for record and read access lands with the
SOC-04B split reads, which also supply the owed shares; until then the
split ID is opaque and any provisioned user may record or read.

### Social operations

Cross-user transaction sharing (`backend/internal/sharing`, store consent
methods, `docs/authorization.md`) is retry-safe and traceable:

- Every mutating social request (grant, revoke, exclusion, removal,
  accept, link refresh) carries a client-generated UUID request ID in
  canonical lowercase form: over HTTP (`requestId`) for grant, revoke,
  exclusion, removal, and accept, optionally for link refresh (which
  mints a server key when none travels), and at the store boundary for
  all six. The store records one outcome row per (actor, request ID):
  a retry with the same key replays the recorded outcome byte-for-byte
  without re-executing, while a key reused for a different action or
  target fails with `store.ErrSharingConflict` (HTTP 409, no
  session-discovery code). Failed attempts never consume the key.
- A source revision landing mid-accept fails explicitly with
  `store.ErrSharingConflict` and rolls the copy back instead of recording
  a torn link. Concurrent accepts losing the deterministic link-identity
  race resolve to the winner's copy instead of leaking a uniqueness
  error. The four consent mutations each run in one transaction on the
  store's single connection, so grant/revoke/exclude ordering is total.
  Accept and refresh commit in the documented statement order
  (link/provenance update, then audit, then key), so an interrupted
  request retries as a new execution converging to current rather than
  replaying an unapplied outcome.
- Committed mutations append one `sharing_audit` row carrying actor,
  action, target identities, link, outcome status, request ID, and time.
  Replays and heals append none. Owners read their transaction's trace at
  `GET /v1/shared/audit`; see [authorization](docs/authorization.md#social-operation-audit-and-idempotency) for the full audit contract. Audit payloads
  never carry transaction evidence (no amounts, names, accounts, memos,
  or transaction content). Replays return the recorded result to its own
  actor only; the accept replay is the recipient's own copy, never a
  cross-user read.

Dependents reuse this shape: versioned splits (SOC-04B) close retry races
with request IDs and fail concurrent revisions explicitly, and
concurrency coverage (QA-02) asserts idempotent replay through these
endpoints plus share/revoke ordering at the store boundary.

## 4. Result Identity

Slices, generated rows, statistics, and evaluation outputs persist and are
assembled when the stored state is clean and the request matches the built
state (run count, frozen seed, evaluation tables). Every cache-miss canonical
build computes the full window, persists the invalid suffix, and assembles
from stored rows; non-canonical inputs bypass stored rows and compute
directly. Repeat identical inputs produce identical outputs because the
kernels are deterministic for a fixed seed. The `Projection-Source` header
stays `computed` or `shared` and does not carry a stored marker. See
[unified projection](docs/unified-projection.md).

Consequences:

- omitting the model body uses the stored snapshot, so saved model changes alter the next result;
- disabled settings evaluation configs still skip their evaluations, but every call re-evaluates what is enabled;
- seeded stochastic runs with equal run count and seed draw the same sequence;
- unseeded stochastic runs draw fresh samples per call;
- projection payloads keep dates as strings, `projectionStartTransactionState` as a plain JSON object, and evaluation `deterministic`/`probabilistic` values as arbitrary JSON.

## 5. Model Semantics

### Accounts

Accounts are ordered rows with a unique ID, label, bounds, optional color, and enabled flag. Net worth sums only enabled accounts.

- `NoFloor` is `-1e13`.
- `NoCeiling` is `+1e13`.
- A source can withdraw only `max(0, balance - minBalance)`.
- A destination can receive only `max(0, maxBalance - balance)`.
- Bounds are structural constraints, not labels or categories.

### Transaction and recurrence-rule structure

Transactions are single timed transactions: one record of money moved, carrying
posted time (when the bank posts it) and transaction time (when the money
moves), both Unix seconds. Repetition is owned by recurrence rules, which
expand into occurrences at projection time. A transaction with a `claim`
(`scheduleId` plus `occurrenceDate`, both set manually) records the actual for
one scheduled occurrence; history replays the actual and skips the generated
occurrence.

Transaction and rule behavior is selected only by source and destination presence:

| Source  | Destinations | Behavior                    |
| ------- | ------------ | --------------------------- |
| absent  | present      | external inflow             |
| present | absent       | external outflow            |
| present | present      | account-to-account transfer |

`enabled` controls participation. One-time transactions carry posted and
transaction Unix times and always execute before scheduled rule
occurrences on the same day, ordered by transaction time, then posted
time, then ID. Rules carry `priority`, which orders rule occurrences
after all one-time transactions on the same day; declaration sequence breaks
priority ties.

A rule occurrence executes exactly on its scheduled date. Schedules use 365-day years, 52-week years, and clamped calendar-month/year addition.

### Amount resolution

`TransactionAmountResolution` contains a resolver name, resolver config, and exact required inputs. Each input is either a finite literal or a named provider binding.

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

`expression` amounts carry rate behavior in their inputs: the `occurrence-rate` provider resolves the annual rate (sampled per projection year when volatile) divided by the frequency divisor, and the `growth-factor` provider resolves the compounding factor from the rule start date. One-time and recurring transactions resolve through the same path. Transaction references (`model-value`) may name transaction or rule IDs; a rule reference resolves to its latest realized occurrence. Payroll chains rules by priority and `model-value`: gross pay, pre-tax contributions, employer match, and a `progressive-bracket` tax rule compose take-home pay from ordinary transactions.

Layman discovery: `GET /v1/amount-resolvers` returns `resolvers` and `providers` as wiring only (entry names, technical descriptions, field keys, field kinds, required flags, and provider volatility). All human words live in the frontend. Amount presets are owned by the Amount presets section above; applying a preset copies its amount descriptor into a transaction or rule, so simulation never reads presets.

### Constraints and transaction records

`ResolveAccountTransaction` clamps a nonnegative requested amount by:

1. an optional action limit, such as remaining annual cap;
2. positive source withdrawable balance;
3. total destination headroom.

`TransitionRuntime` applies the realized amount and records ordered account deltas. Every transaction exposes requested and realized amounts, which is the causal evidence used by fulfillment and financial-independence diagnostics.

Annual-cap usage is observed from realized amounts by transaction ID (transaction or rule) and calendar year. Caps live on rules only; a claimed actual accrues under its own transaction ID.

## 6. Validation and Preparation

`domain.ValidateFinancialModel` performs complete validation for projections,
evaluation writes, and model diagnostics. Finance reads and writes use the
financial-record subset without a forecast-readiness requirement. Finance writes
also reject newly introduced evaluation reference errors.

Complete validation checks:

- duplicate account, transaction, rule, and cross-type evaluation IDs;
- account/transaction/rule ID collisions (one shared namespace);
- checkpoint account and required instant (every observation carries only
  its exact Unix time; there is no Date field and no zero sentinel), and
  the timestamp-only key (several observations per day survive; only the
  exact same account/instant collides);
- amount resolver config, exact required inputs, provider references, and transaction dependency cycles spanning transactions and rules;
- transaction and rule source/destination references, duplicate destinations, same-account routing, rule schedules, and claim validity (named rule exists, date is a real scheduled occurrence, no double claims);
- account bounds;
- evaluation instance IDs and config.

Warnings and errors share the ordered `ModelValidationIssue` shape. `SeverityError` blocks persistence and simulation. `SeverityWarning` does not.

`PrepareSimulationRequest`:

1. applies request overrides without mutating the input model;
2. validates the effective model;
3. validates `fallbackProjectionStartDate`;
4. replays historical state;
5. computes the clamped projection end date;
6. creates one `types.SimulationRequest`.

## 7. Historical Replay and Checkpoints

Historical preparation uses the same `TransitionRuntime` as projection execution.

The as-of cut is a single instant: a `YYYY-MM-DD` date means the end of
that UTC day (inclusive); an RFC 3339 timestamp means
that exact instant. Only events and observations at or before the cut
replay; everything after it is future. Observations after the projection
start are invalid.

- History is one sorted event list, one forward pass: each transaction at its
  effective instant (transactions at their stored Unix time including 00:00;
  rules at the day-close of their date) and each observation at its exact
  instant. No date-wide gates, no per-day phases, no identity-suppression
  maps. Claimed rule occurrences never replay.
- Ties execute transactions before observations so a rule at 23:59:59 anchors
  before an observation at the same instant; owner observations execute
  last at the same instant. Daily snapshots sample the resulting state;
  they are not alternative execution phases.
- Observations SET their account balance; transactions CHANGE balances; a
  later observation SETS again and records the observed-vs-modeled
  discrepancy as a checkpoint correction. Each anchor is per-account and
  absolute. Observations sort by instant, so arrival order never matters
  and a backdated observation cannot roll the latest state back.
- Confirmed one-time actuals move their recorded amount. Generated modeled
  rules keep hypothetical funding clamps and caps; pending/void rows never
  move.
- The simulation continues after the same cut instant, skipping
  already-replayed occurrences so nothing executes twice.

Each historical correction records observed balance, modeled balance, and adjustment. Historical rows carry no projected transaction totals. Replay still updates balances, latest realized transaction amounts, and annual-cap state for later projection and amount providers. `GET /v1/accounts/balances` and `POST /v1/position` report the same replay: adjusted modeled balances with the latest observation (balance plus timestamp) carried separately per account, never a folded latest checkpoint.

`BuildProjectionPath` prefixes these historical observations with projected snapshots. `ProjectionRow.isHistorical` marks the boundary.

## 8. Deterministic Kernel

`Simulate` accepts only a prepared `types.SimulationRequest`. It does not resolve overrides, dates, evaluations, or persistence state.

The kernel:

1. creates a `TransitionRuntime` from the prepared model, state, date, and optional sampled rates;
2. expands enabled occurrences through the projection window via the preprocessor (`ExpandProjectionSchedule`; history, candidates, and branch windows keep their own local expansion);
3. sorts dates and same-date occurrences, skipping occurrences named in `SuppressedIdentities` (exact-cut history already replayed them);
4. prepares each occurrence amount from snapshots without touching runtime state (`PrepareTransactionExecution`: scheduled, sampled, and model-value inputs resolve here);
5. applies each prepared request through the shared transition path (`ApplyPreparedExecution`: constraint clamping, balance mutation, and ledger recording live here — the only place impossible states are handled);
6. records every requested/realized transaction and ordered account deltas;
7. snapshots balances after each event date;
8. returns exact initial state, final state, snapshots, transactions, and sample metadata.

`BuildProjectionPath` adapts exact results for evaluators. `AdaptSimulationRun` then creates the public `ProjectionResult` by:

- separating historical and projected rows;
- classifying each projected transaction structurally;
- computing current and final net worth;
- accumulating external inflow, external outflow, and internal transfer totals;
- rounding public monetary values with `roundCurrency`.

`ProjectFinancialModel` adds the configured evaluation tables.

## 9. Evaluation Runtime

`EvaluationRegistry` holds the process-wide definitions:

| Go definition                     | Type                    |
| --------------------------------- | ----------------------- |
| `financialIndependenceDefinition` | `financialIndependence` |
| `netWorthThresholdDefinition`     | `netWorthThreshold`     |
| `accountBalanceDefinition`        | `accountBalance`        |
| `transactionFulfillmentDefinition`    | `transactionFulfillment`    |
| `cycleFulfillmentDefinition`      | `cycleFulfillment`      |
| `plannedPurchasesDefinition`      | `plannedPurchases`      |
| `whatIfDefinition`                | `whatIf`                |

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

Transaction fulfillment and public transaction evidence share the per-event assessment in `evaluateTransactionEvents`. Public `transactionEvents[].fulfillment` reports unfulfilled and destination-limited amounts, including the canonical reportable threshold and rounding. Funding gaps and Safe spending consume these amounts rather than classify failures themselves. This evidence remains available when configured fulfillment evaluations are absent, disabled, or limited to selected transactions. The Funding gaps account-history ledger explains the result; it does not determine fundability.

Outlook renders only saved evaluation pins, using the same compact evaluation card components as the Evaluations page. Net-worth and account-balance targets have no automatic preview or fallback selection. Funding gaps has no separate always-visible panel. Pins control Outlook visibility; unpinning does not disable an evaluation. Threshold cards show the first-crossing date, current amount, target, and scenario result directly, without an evidence dialog. The shared Funding gaps card's cash-flow inspector follows the evaluation's configured transaction selection.

### Financial independence

`EvaluateFinancialIndependence` builds canonical monthly candidate dates. For each candidate it measures net worth, selected annual direct income, selected asset balances, withdrawal capacity, annual expense target, and coverage.

The full principal-preservation cycle uses the generic monthly behavior loop and `TransitionRuntime`:

- selected cashflow sources are observed from the base path;
- only explicitly selected continuing transactions (transactions or rules) execute in the branch;
- monthly expenses are covered by reactive withdrawals;
- withdrawals obey account floors, nonnegative balance, and annual withdrawal limits;
- a cycle fails at the first unresolved expense shortfall;
- principal policy is `allow-drawdown`, `preserve-nominal-principal`, or `preserve-real-principal`;
- summary scans stop at the first successful candidate;
- detailed deterministic output reruns the selected candidate with full withdrawal and balance evidence;
- stochastic output aggregates first-success dates and coverage distributions against required confidence.

Continuing transactions are never inferred from IDs, labels, categories, or nonzero rates.

### Net-worth threshold

`EvaluateNetWorthThreshold` scans projected rows only and returns the first date at which net worth reaches the configured target. Stochastic aggregation reports success probability and P10, median, and P90 reached dates across successful sampled outcomes.

### Transaction fulfillment

`EvaluateTransactionFulfillment` selects all transactions when `transactionIds` is null, or the configured subset otherwise. It reconstructs pre-event balances, classifies binding constraints, and reports requested, realized, destination-limited, and unfulfilled amounts.

A residual below 0.5 is not reportable. Deterministic output includes first underfulfilled date plus event, date, and transaction summaries. Stochastic output reports full-fulfillment probability and unfulfilled-amount percentiles.

## 10. Stochastic Kernel

`StochasticProjection` creates one `stochasticSession` and one prepared baseline request. When no enabled rule or transaction carries a volatile amount, Monte Carlo stays fully opt-in: the session simulates once and folds that path into every trial, which is bit-identical to N identical trials at ~1/N the cost. Otherwise the session then:

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

The seed controls the state sequence. Run-count normalization and seed-null behavior are part of the sharing contract.

### Numeric precision

`golden_test.go` compares numeric goldens with relative-scaled tolerance `1e-9 * max(max(abs(expected), abs(actual)), 1)` across deterministic projection, checkpoint replay, paycheck rule-chain resolution, and seeded stochastic bands, milestones, and evaluations. Tighten it only with matching evidence across all covered fixtures.

A non-null seed produces the established 31-bit linear-congruential sequence `(state * 1664525 + 1013904223)` computed in `float64`, reduced modulo `2^32` and masked with `0x7fffffff`; uniforms are `state / 0x7fffffff`. Sampling consumes two uniforms per variable annual rate with the established log-normal transform (see `sampler.go`).

Two rounding rules stay explicit: deterministic public currency, fulfillment amounts, and evaluation summaries use `math.Round` (halves away from zero); stochastic net-worth samples use `mathRound(value) = math.Floor(value + 0.5)` (halves toward positive infinity). Currency summaries multiply by 100, round, and divide by 100. A change to a negative half value is a contract change.

## 11. SimpleFIN Flow

### Provider contracts

`internal/integrations` defines the replaceable provider contract behind the
integrations management page. A `Provider` adapter reports one user-scoped,
display-only status snapshot (`connected`, `syncConfigured`, connection and
last-sync times, and non-secret detail such as the Bridge host). The
`Registry` snapshots adapters in list order, and `GET /v1/integrations`
serves that snapshot. `NewSimpleFIN` adapts the existing Bridge sync;
`NewGmail` adapts the Gmail OAuth connection under its own ID and
endpoints without changing this contract. Snapshots never contain
credential secrets; per-user isolation is covered by same-database
two-user tests in `internal/integrations` and the `list-integrations`
contract test in `internal/api/integration`.

### Gmail connection

`internal/gmail` owns the Gmail read-only OAuth connection. Consent uses
exactly the `gmail.readonly` scope with offline access and a consent
prompt; the pending CSRF state lives on the user's row, expires after ten
minutes, and clears on consumption. A mismatched state is rejected
without clearing, so a forged callback cannot wipe an in-flight flow.
Refresh and access tokens persist only in the
per-user `gmail_credentials` row and refresh server-side on demand;
payloads carry display-only state (account address, connection time,
lookback, last scan). Disconnect revokes the grant at Google
best-effort and forgets tokens, account, and cursor while keeping the
lookback preference. The initial scan window defaults to 90 days and is
configurable from 1 to 365 days; the first scan looks back from now and
later scans resume from the stored history cursor (scan execution itself
is INT-03). Fresh databases get the table from the shared schema;
pre-existing databases gain it on first Gmail use with no row conversion.
Production needs a verified Google OAuth client and privacy review before
any production-facing consent flow.

### Gmail receipt discovery

`internal/gmail` also owns receipt discovery over the same connection.
`POST /v1/integrations/gmail/scan` refreshes the access token
server-side, lists the initial window (`newer_than` lookback days) or the
incremental history cursor, triages each unseen message, and advances the
cursor. Detection is deterministic local heuristics: receipt or refund
signals plus an amount make a receipt; shipping signals without an amount
make a shipping-only update; everything else is ordinary mail and stays
out of extraction. Extraction records merchant (sender display name),
message date, amount with currency, and an order/invoice/reference
number; anything below 0.75 confidence (or missing an amount) is stored
as needs-review for the user to confirm or correct in the Gmail panel.
Every scanned message keeps one `email_receipts` row keyed by Gmail
message ID, so repeat scans dedupe without refetching; receipt-like rows
carry extracted evidence with `gmail-receipt-email/v1` provenance while
ordinary and shipping-only rows keep identity and verdict only. Message
bodies and snippets are never persisted. Per-message fetch/parse
failures are isolated as failed rows with diagnostics; the scanner holds
no reference to transactions or balances, so parser errors never mutate
financial state. `GET /v1/integrations/gmail/receipts` lists evidence
with verdict/status filters and `PATCH .../receipts/{id}` confirms or
corrects one extraction, overlaying the original values without
rewriting them. The extracted-evidence contract for INT-04 matching is
the stored row: merchant, receipt date, amount cents plus source amount
spelling, currency, reference, confidence, diagnostics, provenance, and
the user correction overlay.

`internal/simplefin` is configured once in `cmd/server`:

- The Bridge key is connected per user through `POST /v1/sync/simplefin/credential` and stored in `sync_credentials`.
- Account links live in the `account_links` table. Bridge identity is the connection-scoped key `sf2.<conn_id>.<account_id>`, not a bare account ID. Sync uses current keys without a runtime migration check. Offline key conversion remains available through `simplefin-v2-keys`.
- The client sends SimpleFIN protocol version 2 and rejects a response without both `errlist` and `connections`. General and authentication errors fail the run, except the verified `gen.api` notices for the 90-day cap and 45-day recommendation. Those notices accompany usable data and remain visible while the database accepts the data. Connection and account errors exclude only the affected rows, so an incomplete snapshot never voids healthy pending holds. The last condition is stored on the provider connection row and exposed as `syncError` on `/v1/status`; a clean success clears it. Structured response logs record requested dates, connection/account/transaction counts, and notice codes before error classification. Applied-sync logs record provisioning and row-change counts. Neither log contains credentials, balances, account names, or transaction details.
- Card selection is stored per user in `sync_credentials` for safe-spending math; bank mirroring covers every mapped account regardless of cards.
- Bridge accounts with no link are auto-provisioned as model accounts (investment when holdings are reported, cash otherwise) with an `auto` link; `GET /v1/sync/simplefin/accounts` lists links and snapshots for user relinking, `PUT`/`DELETE` manage them. Disaster recovery is a database backup: links live in `account_links` beside the data.
- The synced-account list offers one account-mapping action: `POST /v1/sync/simplefin/accounts/{bridgeAccountId}/supersede` retires one manual account in favor of the synced account already linked to that bridge account. The synced account keeps its link and bank facts. The manual account's list slot, name, color, kind, balance limits, payment terms, recurrence routes, planned-purchase funding, safe-spending selections, card selections, evaluation references, and sharing-policy account selections move to it. The manual account, its owner transactions, and its checkpoints are deleted. A manual account that already carries bank checkpoints or bank transactions is rejected, as is a stale bridge link. The candidate is validated before commit; a rejected candidate returns issues with `saved: false` and changes nothing.
- A bridge account that vanishes keeps its link, rows, and data (stale, never deleted by sync).

`Runner.Sync` delegates to the ingest orchestrator with the SimpleFIN adapter. Until the workspace records its first successful sync, the orchestrator requests the previous 90 days. Later runs request a rolling 30 days, even after longer gaps or new bank connections. Both windows end at the current instant and include pending data, within the Bridge's 90-day request limit. It resolves bridge accounts through stored links, provisions unmapped USD accounts, then `Translate` preserves the bridge balance-date as the observation instant (falling back to arrival time when the bridge reports none) and emits every instant as its own checkpoint row plus pending and posted transactions on every mapped USD account. The checkpoint also carries the Bridge's `available-balance` when present in the additive `checkpoint_available_balances` sidecar. The posted balance remains the sole net-worth authority; available balance is nullable evidence for safe-spending and card headroom. Unmapped, non-USD, and invalid-amount rows are counted by reason without logging descriptions or amounts.

The adapter reconciles the snapshot against stored bank rows into directives (`backend/internal/simplefin/reconcile.go`); `Store.ApplySync` applies checkpoints and directives in one transaction without interpreting provider behavior, then marks the projection dirty from the earliest applied Unix instant. Settled bank posts are normal participants at transaction time: the translation emits them enabled with the event time normalized to the posted instant, and replay executes them through the same actual path as manual transactions. There is no bank-evidence-only participation policy. Pending and void rows stay disabled and never move balances.

One-off legacy interpretation, stated plainly: in databases written
before this change, a disabled settled bank row does not distinguish the
old importer default from an explicit pre-upgrade API owner disable
(`UpdateTransaction` persists `enabled` on settled bank rows, and bank rows
are readable in the UI but only the API could have written the flag).
The one-time offline script therefore enables ALL legacy settled bank
rows, including any pre-upgrade API disables; that is the documented
cost of the repair, and operator release notes should call it out.
Post-upgrade owner disables remain honored: the script only converts
legacy date-shaped databases and only verifies already-converted ones,
so a repeat run never re-enables an explicit disable. Delete-plus-
tombstone exclusions are preserved in both cases. Backdated observations are retained as distinct instant-keyed rows while an owner row at the same instant keeps precedence and a same-instant sync row replaces idempotently. Exact provider/account/transaction keys map to store-allocated UUIDs, so repeat feeds refresh the same rows. Vanished pending rows void in place; nothing the bank reported is ever deleted. The settlement matcher reads merchant behavior classes from `backend/internal/simplefin/profiles.json`. `GET /v1/transactions/{id}/settle-candidates` exposes the same ranked candidates to the browser, so the frontend keeps no matching rule. Summary counters distinguish `pendingInserted`, `pendingUpdated`, `pendingDeleted`, `settledConverted`, and `settledInserted`.

The scheduler calls `Runner.Sync` every 6 hours at the next 6-hour boundary (00, 06, 12, 18 local) plus a random minute offset. Manual triggers use `Runner.Trigger`, which rejects concurrent and too-recent successful runs. Successful runs persist their completion time; `GET /v1/status` exposes it as `lastSyncAt` alongside `syncConfigured`.
