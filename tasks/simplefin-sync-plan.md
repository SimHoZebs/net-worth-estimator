# SimpleFIN Synchronization Plan

## Objective

Synchronize the narrow set of source data that the financial model cannot infer safely: current mapped account balances and pending negative card charges. Keep the source secret, make row ownership explicit, make dry-run the first live operator step, and preserve a recoverable cutover path.

## Scope

Each synchronization run may write only:

1. **Balance checkpoints** for mapped accounts.
2. **Pending card-charge seeds** as disabled one-time postings for configured card accounts.

The integration does not materialize:

- checking transactions;
- salary, bill, or transfer history;
- positive card transactions or refunds;
- posted card charges;
- investment transactions;
- unmapped, non-USD, or invalid-amount rows.

Rows outside scope are counted by reason. Amounts and descriptions are omitted from normal log fields. The Access URL is kept in secret configuration; transport failures can wrap its request URL and require sensitive-error handling.

## Security Contract

- `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` is a server-side secret.
- The secret is read from the environment or platform secret store and is absent from status, model, and successful sync-summary payloads.
- Protocol errors disclose only the Bridge host and status. HTTP transport errors can wrap the full request URL; failed trigger responses and scheduler logs are therefore sensitive until error redaction is implemented.
- Derived checkpoints and pending labels are visible through `GET /v1/financial-model`; protect that route according to the separate access-control plan if the resulting balances are sensitive.
- `POST /v1/sync/simplefin` uses the same read-only and bearer policy as canonical model saves.
- Dry-run mode must not commit source rows, even when the fetch and mapping succeed.
- One service instance owns the scheduler and SQLite writer. Multiple scheduler replicas are outside this plan.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` | real mode | Bridge Access URL secret; an empty value disables the runner |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS` | when mappings exist | comma-separated `bridge-account-id=model-account-id` entries |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS` | for pending seeds | comma-separated model account IDs treated as cards |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN` | optional | exact value `1` enables dry-run; all other values disable it |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK` | fixture mode only | exact value `1` enables deterministic fixture responses |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK_FILE` | optional | Bridge-shaped JSON file, valid only when fixture mode is enabled |

Startup rules:

- an unparseable account map is fatal;
- fixture mode and a real Access URL are mutually exclusive;
- a fixture file without fixture mode is fatal;
- an empty Access URL without fixture mode disables synchronization and makes the trigger return 503;
- changing a secret requires a service restart.

## Row Ownership and Migration

Schema version 3 adds `source TEXT NOT NULL DEFAULT 'model'` to checkpoints and postings. Existing rows are owner rows.

The reserved `store.SyncPostingPrefix` is `sfin-`. Pending posting IDs use `sfin-pending-<model-account>-<sanitized-transaction-id>`.

### Model-save coexistence

`store.SaveDocument` snapshots stored sync rows, strips owner payload IDs in the reserved namespace, replaces owner rows, and re-merges stored sync rows in one transaction.

Checkpoint behavior:

- stored sync rows survive a model save;
- an incoming owner checkpoint with the same account/date and same balance preserves sync ownership;
- an incoming owner checkpoint with the same account/date and a different balance becomes the owner row;
- the colliding sync checkpoint is omitted;
- later synchronization skips that account/date while the owner row exists;
- the owner row is restored to sync ownership only when the model no longer supplies that exact checkpoint.

Posting behavior:

- incoming `sfin-` IDs are dropped;
- stored sync pending postings are re-merged;
- an owner model cannot edit or delete a sync pending posting through a model save;
- removing a mapped account from the canonical document does not garbage-collect sync rows, because sync persistence is independent of the current account map.

Any future ownership migration must preserve this collision contract and add a package test before runtime rollout. Migrations are forward-only, transactional, data-preserving, and applied by `store.Open`.

## Mapping Contract

### Balance checkpoints

For each mapped Bridge account:

- accept an empty currency or `USD`; skip other currencies;
- parse the balance as a numeric decimal;
- use the UTC day from `balance-date`, or the current UTC day when absent;
- create at most one checkpoint per model-account/date key;
- keep the balance sign, including a negative card balance.

### Pending charges

For mapped model accounts listed in the card set:

- inspect transactions only after the balance checkpoint is mapped;
- require a pending flag, or `posted == 0` when the flag is absent;
- skip posted rows;
- require a parseable negative amount;
- skip zero and positive amounts;
- create one disabled one-time external-outflow posting;
- set `sourceAccountId` to the mapped card;
- leave destinations absent;
- use a literal expression containing the absolute decimal amount;
- set the start date from `transacted_at` when present, otherwise the posted day, otherwise the current UTC day;
- truncate the display label to 80 Unicode characters;
- set priority to `simplefin.PendingPriority` (`6`).

Disabled pending rows do not execute in projection. This prevents a pending charge and its later posted form from both affecting a projection while preserving the source record for inspection and explicit model decisions.

### Skip accounting

`Plan.Skipped` counts:

- unmapped account;
- non-USD account;
- posted row;
- non-charge row;
- bad amount.

The trigger summary returns counts only. It does not return raw account balances, transaction descriptions, or source identifiers.

## Transactional Apply

`store.ApplySyncPlan` runs one transaction:

1. insert a sync checkpoint when the account/date key is absent;
2. update it when the existing row is sync-owned;
3. skip it when an owner checkpoint owns the key;
4. delete the existing sync pending snapshot for each configured card;
5. insert the fresh pending snapshot;
6. commit, unless dry-run is active.

Pending deletion is constrained by all of:

- `source = 'simplefin'`;
- the configured card account;
- escaped `sfin-pending-<account>-%` pattern.

It never uses a broad namespace match across all accounts.

Dry-run performs the same count work and returns before commit. The deferred rollback then leaves every table unchanged.

## Fetch and Failure Semantics

`simplefin.Client.Fetch`:

- requests `<Access-URL>/accounts`;
- requests a 90-day history window ending 24 hours after the run time;
- sets `pending=1`;
- uses a 60-second HTTP timeout by default;
- limits the response body to 32 MiB;
- accepts only HTTP 200;
- aborts on the supplied context.

A failed fetch, malformed payload, or apply error does not update the successful-trigger timestamp. A later manual trigger can retry. The scheduler runs once per local day; no same-run retry policy is part of this plan.

## Scheduler and Manual Trigger

### Scheduler

`cmd/server` starts one scheduler when a runner is configured. It selects a random minute from 00 through 59 after 03:00 local time, then repeats every 24 hours. The scheduler calls `Runner.Sync` directly, so it does not use the 20-hour manual-trigger guard.

Operational constraints:

- run exactly one service instance with the scheduler;
- keep the database on durable storage;
- do not run a manual write concurrently with a scheduled write;
- inspect application logs for summarized success or failure; treat failed sync entries as sensitive because transport errors can wrap the Access URL.

### Manual trigger

`Runner.Trigger` wraps `Runner.Sync` with process-local guards:

| State | Result |
| --- | --- |
| no active run and no recent success | execute |
| active run | `InProgressError` → HTTP 409 |
| successful run less than 20 hours old | `TooSoonError` → HTTP 429 |
| prior attempt failed | remain eligible for retry |
| runner unconfigured | HTTP 503 before runner execution |

The interval stamp is in memory and clears on process restart.

## Fixture Mode

Fixture mode is a temporary operator aid, not a separate persistence mode.

- Built-in fixture account IDs are `mock-checking` and `mock-prime`.
- The default fixture contains one checking balance, one card balance, one pending charge, one posted charge, one positive pending transaction, and one card payment.
- An optional fixture file is reloaded on every fetch.
- Fixture and real runs both pass through `Map`, `Runner.Sync`, and `Store.ApplySyncPlan`.
- Stored rows are indistinguishable by design: both use `source='simplefin'` and `sfin-pending-*`.

This makes cutover an explicit database purge rather than a code branch.

## Cutover Plan

### Prerequisites

1. Obtain the Bridge Access URL through the secret store.
2. Obtain stable Bridge account IDs and build the account map.
3. Decide which mapped model accounts are cards.
4. Confirm the persistent database path and create a verified SQLite backup.
5. Confirm the service has one instance.
6. Start with dry-run enabled.

### From fixture to real source

1. Stop the service so no scheduled or manual run can write during cutover.
2. Open the backed-up database and run the preview statements in `backend/scripts/purge-simplefin-sync.sql`.
3. Confirm the preview lists the expected sync-owned postings and checkpoints.
4. Execute the two `DELETE` statements in that script. It removes all `simplefin` rows; owner rows remain.
5. Unset `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK` and `NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK_FILE`.
6. Set the real Access URL, account map, and card list as secrets or runtime variables.
7. Keep `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN=1` and restart the service.
8. Trigger once through `POST /v1/sync/simplefin` with the required bearer token.
9. Inspect checkpoint insert/update/skip counts, pending delete/insert counts, skip reasons, and `dryRun: true`.
10. Reload the model and confirm the database contains no newly committed source rows from the dry-run.

### First real write

1. Set `NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN` to an empty value and restart the service.
2. Trigger immediately, or allow the next scheduled run. An immediate manual trigger is available because restart clears the in-memory trigger stamp.
3. Inspect the non-dry-run summary.
4. Reload the model and verify source markers, account/date keys, negative card checkpoint, and disabled pending rows.
5. Repeat a planned run and verify owner checkpoint collisions, pending snapshot replacement, and idempotent count behavior.

### Removal of fixture mode

Once real synchronization is proven:

- delete the fixture implementation and tests;
- remove fixture parsing and runner wiring from `cmd/server`;
- remove fixture variables from environment documentation and retained operator docs;
- verify no fixture symbols or mock-mode variables remain in the backend.

## Verification

### Go packages

```bash
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh ./cmd/server
```

Required coverage:

- account-map parsing and startup failure;
- redacted protocol fixture mapping;
- positive, posted, non-USD, invalid, and unmapped skip reasons;
- deterministic pending IDs and row shape;
- checkpoint insert/update/owner-skip behavior;
- pending snapshot replacement and owner-posting preservation;
- dry-run rollback;
- model-save strip-and-merge behavior;
- forged reserved IDs being dropped;
- exact owner checkpoint collision precedence;
- trigger 401/403/409/429 behavior;
- successful-only interval stamping;
- concurrent-run refusal;
- purge script preserving owner rows;
- source secret redaction.

### Operator checks

1. Dry-run returns 200 with `dryRun: true` and zero committed source-row changes.
2. First real run creates or updates only mapped balance checkpoints.
3. Only configured card accounts receive pending rows.
4. Pending rows are disabled one-time postings with negative charge magnitude and reserved IDs.
5. A second real run refreshes pending rows without duplicating checkpoints.
6. An owner checkpoint at the same account/date is not overwritten.
7. A rejected trigger leaves the database unchanged.
8. A server restart does not erase owner rows or the last committed source snapshot.

## Completion Criteria

- The Access URL is stored in server-side secret configuration and omitted from successful payloads; transport-error redaction is a production requirement.
- Dry-run is verified before the first committed run.
- Scheduler and manual-trigger behavior remain single-process and guarded.
- Sync-owned rows survive model saves and cannot be forged by model payloads.
- Owner checkpoint precedence is covered by package and operator checks.
- Fixture-to-real cutover uses the versioned purge script and a verified backup.
- All listed production-package verification gates pass before fixture removal and before production cutover.
