# SimpleFIN Synchronization Plan

Status: implemented. Current contracts live in `backend/cmd/server/sync.go`, `backend/internal/simplefin/`, and `TECHNICAL_OVERVIEW.md` §§3, 11. This file records planning history; intervals below are stale where they disagree with code (scheduler is every 6 hours, manual-trigger spacing defaults to 6 hours).

## Objective

Synchronize the narrow set of source data that the financial model cannot infer safely: current mapped account balances and pending negative card charges. Keep the source secret, make row ownership explicit, and preserve a recoverable backup path.

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
- `POST /v1/sync/simplefin` uses the same read-only and bearer policy as row writes.
- One service instance owns the scheduler and SQLite writer. Multiple scheduler replicas are outside this plan.

## Configuration

| Variable                                   | Required          | Meaning                                                      |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------ |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL` | real mode         | Bridge Access URL secret; an empty value disables the runner |
| `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS`      | for pending seeds | comma-separated model account IDs treated as cards           |

Startup rules:

- an empty Access URL disables synchronization and makes the trigger return 503;
- env bootstrap entries pointing at missing model accounts fail the sync loudly instead of writing ghost checkpoints;
- changing a secret requires a service restart.

## Row Ownership, Links, and Migration

Schema version 3 adds `source TEXT NOT NULL DEFAULT 'model'` to checkpoints and postings. Existing rows are owner rows. Schema version 8 adds `entity_ids` (shared ID registry) and `account_links` (bridge-to-model bindings with snapshot, origin, and last-seen date).

The reserved `store.SyncPostingPrefix` is `sfin-`. Pending posting IDs use `sfin-pending-<model-account>-<sanitized-transaction-id>`.

### Linking and provisioning

Each sync resolves bridge accounts through `account_links` plus env bootstrap, then provisions unknown USD accounts as model accounts (investment with holdings, else cash) with `auto` links. `GET /v1/sync/simplefin/accounts` lists links and snapshots with zero Bridge quota; `PUT`/`DELETE` manage bindings. A vanished bridge account keeps its link, rows, and data.

### Owner-write coexistence

Row writes replace the retired whole-document save. Incoming `source` values are ignored and sync-namespace IDs are rejected, so stored sync rows cannot be forged, edited, or deleted through row writes. Owner checkpoints win key collisions; later synchronization skips the owner-owned key until owner data is removed. Deleting an account never garbage-collects sync rows or links.

### Seed and import coexistence

`replaceDocument` (seed/import path) snapshots stored sync rows, drops forged `sfin-` IDs from the incoming document, replaces owner rows, and re-merges stored sync rows in one transaction.

Checkpoint behavior:

- stored sync rows survive a seed;
- an incoming owner checkpoint with the same key wins and becomes the owner row;
- a later synchronization skips the owner-owned key until owner data is removed.

Posting behavior:

- incoming `sfin-` IDs are dropped;
- stored sync pending postings are re-merged;
- removing an account from the seed does not garbage-collect sync rows or links, because sync persistence is independent of linking.

Any future ownership migration must preserve this collision contract and add a package test before runtime rollout. Migrations are forward-only, transactional, data-preserving, and applied by `store.Open`.

## Mapping Contract

### Balance checkpoints

For each resolved Bridge account (linked, env-bootstrapped, or auto-provisioned):

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
6. commit.

Pending deletion is constrained by all of:

- `source = 'simplefin'`;
- the configured card account;
- escaped `sfin-pending-<account>-%` pattern.

It never uses a broad namespace match across all accounts.

## Fetch and Failure Semantics

`simplefin.Client.Fetch`:

- requests `<Access-URL>/accounts`;
- requests a 90-day history window ending 24 hours after the run time;
- sets `pending=1`;
- uses a 60-second HTTP timeout by default;
- limits the response body to 32 MiB;
- accepts only HTTP 200;
- aborts on the supplied context.

A failed fetch, malformed payload, or apply error does not update the successful-trigger timestamp. A later manual trigger can retry. Historical note: this plan assumed a daily scheduler; current code runs every 6 hours.

## Scheduler and Manual Trigger

### Scheduler

Historical note: this plan assumed a daily 03:00 scheduler and a 20-hour manual-trigger guard; current code uses a 6-hour scheduler and a 6-hour default trigger interval. `cmd/server` starts one scheduler when a runner is configured. The scheduler calls `Runner.Sync` directly.

Operational constraints:

- run exactly one service instance with the scheduler;
- keep the database on durable storage;
- do not run a manual write concurrently with a scheduled write;
- inspect application logs for summarized success or failure; treat failed sync entries as sensitive because transport errors can wrap the Access URL.

### Manual trigger

`Runner.Trigger` wraps `Runner.Sync` with process-local guards:

| State                                 | Result                           |
| ------------------------------------- | -------------------------------- |
| no active run and no recent success   | execute                          |
| active run                            | `InProgressError` → HTTP 409     |
| successful run less than 20 hours old | `TooSoonError` → HTTP 429        |
| prior attempt failed                  | remain eligible for retry        |
| runner unconfigured                   | HTTP 503 before runner execution |

The interval stamp is in memory and clears on process restart.

## Cutover Plan

### Prerequisites

1. Obtain the Bridge Access URL through the secret store.
2. Decide which model accounts are cards.
3. Confirm the persistent database path and create a verified SQLite backup.
4. Confirm the service has one instance.

### First real write

1. Set the real Access URL and card list as secrets or runtime variables. The first sync auto-provisions model accounts and links; review and relink through the links endpoint.
2. Restart the service.
3. Trigger immediately, or allow the next scheduled run. An immediate manual trigger is available because restart clears the in-memory trigger stamp.
4. Inspect the summary.
5. Reload the model and verify source markers, account/date keys, negative card checkpoint, and disabled pending rows.
6. Repeat a planned run and verify owner checkpoint collisions, pending snapshot replacement, and idempotent count behavior.

## Verification

### Go packages

```bash
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh ./cmd/server
```

Required coverage:

- redacted protocol fixture mapping;
- positive, posted, non-USD, invalid, and unmapped skip reasons;
- deterministic pending IDs and row shape;
- checkpoint insert/update/owner-skip behavior;
- pending snapshot replacement and owner-posting preservation;
- row-write guards (reserved IDs, sync ownership, dangling references);
- forged reserved IDs being dropped;
- exact owner checkpoint collision precedence;
- trigger 401/403/409/429 behavior;
- successful-only interval stamping;
- concurrent-run refusal;
- purge script preserving owner rows;
- source secret redaction.

### Operator checks

1. First real run creates or updates only mapped balance checkpoints.
2. Only configured card accounts receive pending rows.
3. Pending rows are disabled one-time postings with negative charge magnitude and reserved IDs.
4. A second real run refreshes pending rows without duplicating checkpoints.
5. An owner checkpoint at the same account/date is not overwritten.
6. A rejected trigger leaves the database unchanged.
7. A server restart does not erase owner rows or the last committed source snapshot.

## Completion Criteria

- The Access URL is stored in server-side secret configuration and omitted from successful payloads; transport-error redaction is a production requirement.
- Scheduler and manual-trigger behavior remain single-process and guarded.
- Sync-owned rows survive owner writes and cannot be forged by row payloads.
- Owner checkpoint precedence is covered by package and operator checks.
- All listed production-package verification gates pass.
