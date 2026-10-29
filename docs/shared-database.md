# Shared application database

## Boundary

`NET_WORTH_ESTIMATOR_DB` names one application SQLite database. It contains all
private account scopes, the approved guest sample, and application sessions and
grants. Casdoor remains the external identity provider with its own state directory.

An application account is a signed-in user. It differs from a financial account
in the model's `accounts` table. `app_accounts` records immutable OIDC identities.
A private scope is keyed by its owner's application account ID
(`user:<identity-hash>`). The owner key derives from the
exact verified issuer and subject, not a username or email.

Each financial table carries a non-null `account_id`. Composite keys allow the same
entity IDs and preset names in different accounts. Composite foreign keys prevent
relational references across accounts. JSON references validate against the scoped
financial document. The sample uses the reserved `sample` scope without a private
owner. The isolated test fixture uses the reserved `fixture` scope.

Deployment owns database creation and schema setup. The running server only opens
an existing, compatible database. A financial store holds
one immutable account ID. The authenticated router resolves access before it creates
that scope. An empty or missing scope never selects a default private scope.
Wire requests still address scopes as `plans/*` (session discovery and
`Waypoint-Resource` keep the plan form); only stored rows and operator flags
use the account form.

Schema migration records are global. Model metadata, sync state, settings,
ordering, presets, identity registries, and artifact retention are account-scoped.
Application sessions, provider grants, and logout replay records remain global
identity tables. Financial clear, CSV import, refresh, and sample publication
never replace those identity tables.

## Account-scope migration

`shared-plans-v1` databases migrate to `shared-accounts-v1` on next setup.
The migration rebuilds every plan-scoped table with the `account_id` scope
column, backfills `plans/<hash>` rows to their owner's `user:<hash>` scope
(the hash is unchanged), maps the guest sample to the reserved `sample` scope
and the test fixture to `fixture`, then drops the retired `plans` table and
its `shared-plans-v1` marker, so a migrated database claims exactly
`shared-accounts-v1`. Run setup with the API stopped: setup does not
coordinate with a running server, so stop the stack first.

Model-account references keep distinct column names through the migration
(`checkpoints.account_id` becomes `model_account_id`,
`payment_terms.account_id` becomes `model_account_id`, and the provider side
of `posting_sync_keys` becomes `bridge_account_id`), so the new scope column
never collides with a financial reference. Per-account ID namespaces are
preserved: identical entity IDs, preset names, and sync keys remain isolated
across accounts.

Storage lookups keep resolving legacy IDs after migration: `plans/<64-hex
hash>` normalizes to the owner's `user:<hash>` scope and `plans/sample`
selects `sample` (other `plans/*` forms fall back to the bare-owner scope), so
mixed-version tooling keeps working. The session/header wire contract still
uses `plans/*`. Browser state saved under a different resource key is never
restored into the current scope (it stays orphaned under its old key and is
never adopted).

## Initial deployment and schema setup

Provision the database once, before the API starts:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb \
  --db /private/application.db
```

`setupdb` creates the private parent directory, database, and complete financial
and identity schema. Repeat setup preserves existing data and completes an
in-place account-scope migration when one is pending. Run schema setup with
the API stopped when a deployment requires a schema change. Legacy unscoped
databases are unsupported.

The API never creates a missing directory, database, table, or index. It never
repairs an incomplete schema. Missing, empty, and incompatible databases stop
startup with an operator error. The runtime connection uses SQLite `mode=rw`,
which cannot create a missing database. Normal SQLite WAL/SHM journaling remains
part of database operation.

With the authenticated Compose configuration selected, initial container setup is:

```bash
docker compose build backend
docker compose run --rm --no-deps --entrypoint /app/setupdb backend \
  --db /data/net-worth-estimator.db
docker compose up -d
```

Use the same private environment file and volume for setup and the API. Komodo
runs this setup automatically as the stack `post_deploy` step on every deploy,
so app schema changes apply without manual intervention (re-runs are
harmless). Do not put setup in the server entrypoint or an automatic startup
dependency. Outside Komodo, run this maintenance command explicitly.
Dev setup and the isolated fixture harness also provision explicitly.

New user signup still inserts account, scope, and default-preset rows. It does not
create database files or change schema.

## Rollback

Before new writes, stop the API and restore the previous images and database
configuration. Do not silently restore an older backup over current account data.

After new writes, a rollback requires reconciliation or an accepted loss of those
writes. The account-scope migration only runs forward; to return to the
plan-scoped layout, restore the pre-migration backup. Do not silently restore
an older backup over current account data.

## Backups and financial replacement

Treat the whole application database as a credential store. It contains provider
tokens and financial data for every account. A full backup is private and must
never serve as a guest sample or a frontend asset.

A financial replacement selects one explicit account scope. It preserves all other scopes
and all identity state. Sample publication creates an approved snapshot, not a
live alias. It removes private upstream identities, links, sync times, source
paths, migration history, and projection history from the published content.

Server-level SimpleFIN credentials remain bound to the configured owner's scope.
Other private scopes and the sample never inherit those credentials. The global
read-only switch still blocks editor writes.

## Verification

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/plans
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Use identical entity IDs, preset names, sync identities, and projection inputs
in two accounts. Exercise imports, clears, deletes, reorders, sync, and artifact
eviction. Every result must remain within the selected scope. The migration
itself is covered by `TestSetupMigratesPlanScopeToAccountScope`, which replays
a legacy plan-scoped fixture through setup and checks the backfill, and by
`TestAccountScopeIsolationMatrix`, which checks two-account isolation, Clear
containment, and sample independence in one file.

The current deployment keeps one API instance and one SQLite writer.

## Offline account replacement

The destination private scope must already exist. Use a separate migrated source
snapshot and stop the application before this operation:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/refreshplan \
  --db /private/application.db \
  --source /private/approved-snapshot.db \
  --source-account "$SOURCE_ACCOUNT" --account "$TARGET_ACCOUNT"
```

`--plan` and `--source-plan` remain accepted as deprecated aliases for
`--account` and `--source-account`; legacy `plans/*` values normalize to
account scope. Use `--sample` instead of `--account` for approved guest publication. Replacement
discards derived projection artifacts. It preserves destination ownership and
every application identity record. Dev wrappers create a recovery backup first.
Direct command users must take that backup themselves.

The API container includes `setupdb`, `importcsv`, and `refreshplan` under `/app`.
Run operator tools in a separate stopped-stack maintenance container with the
same non-root user and explicit private volume mounts. Do not use an active
server container for migration or account replacement.
