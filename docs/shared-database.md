# Shared application database

## Boundary

`NET_WORTH_ESTIMATOR_DB` names one application SQLite database. It contains all
private plans, the approved guest sample, and application sessions and grants.
Casdoor remains the external identity provider with its own state directory.

An application account is a signed-in user. It differs from a financial account
in the model's `accounts` table. `app_accounts` records immutable OIDC identities.
`plans` records the owner of each private plan. The owner key derives from the
exact verified issuer and subject, not a username or email.

Each financial table carries a non-null `plan_id`. Composite keys allow the same
entity IDs and preset names in different plans. Composite foreign keys prevent
relational references across plans. JSON references validate against the scoped
financial document. The sample uses `plans/sample` without a private owner.

Deployment owns database creation and schema setup. The running server only opens
an existing, compatible database. A financial store holds
one immutable plan ID. The authenticated router resolves access before it creates
that scope. An empty or missing scope never selects a default private plan.

Schema migration records are global. Model metadata, sync state, settings,
ordering, presets, identity registries, and artifact retention are plan-scoped.
Application sessions, provider grants, and logout replay records remain global
identity tables. Financial clear, CSV import, refresh, and sample publication
never replace those identity tables.

## Initial deployment and schema setup

Provision the database once, before the API starts:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/setupdb \
  --db /private/application.db
```

`setupdb` creates the private parent directory, database, and complete financial
and identity schema. Repeat setup preserves existing data. Run schema setup with
the API stopped when a deployment requires a schema change. Legacy unscoped
databases require `migratedb` instead.

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

Use the same private environment file and volume for setup and the API. Run this
maintenance command explicitly. Do not put setup in the server entrypoint or an
automatic startup dependency. A successful `migratedb` already provisions its new
destination. Dev setup and the isolated fixture harness also provision explicitly.

New user signup still inserts account, plan, and default-preset rows. It does not
create database files or change schema.

## Upgrade from per-plan files

Runtime startup does not merge legacy files. Existing financial databases require
an explicit offline migration into a new destination. The operation preserves
plan resource IDs and financial entity IDs. Casdoor issuer, account subjects,
permissions, and signing keys remain unchanged.

Before migration:

1. Stop the API and its background sync scheduler.
2. Back up every primary, private, sample, and application-session database.
3. Back up Casdoor's whole state directory and private deployment configuration.
4. Record the verified issuer and subject for each private database.
5. Approve the exact sample source before publication.
6. Prepare a migration manifest with an explicit source-to-plan mapping.

Use SQLite-safe backups. A raw copy of a live `.db` file can omit committed WAL
data. Never start an old and new server against the same storage.

SQLite documents its [online backup API](https://www.sqlite.org/backup.html)
and [`VACUUM INTO`](https://www.sqlite.org/lang_vacuum.html#vacuuminto) as safe
snapshot methods. Source read transactions must include committed WAL content.

Run migration from the repository root:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/migratedb \
  --manifest /private/migration.json \
  --db /private/application-new.db --dry-run
CGO_ENABLED=0 go -C backend run ./cmd/migratedb \
  --manifest /private/migration.json \
  --db /private/application-new.db
```

### Manifest version 1

```json
{
  "version": 1,
  "sources": [
    {
      "path": "owner.db",
      "resource_id": "plans/<owner-hash>",
      "kind": "private",
      "issuer": "https://issuer.example",
      "subject": "immutable-subject"
    },
    {
      "path": "approved-sample.db",
      "resource_id": "plans/sample",
      "kind": "sample"
    }
  ],
  "sessions_db": "application.sessions"
}
```

Paths resolve relative to the manifest. Add one private source per existing
account. `sessions_db` is optional. A sample source cannot specify an owner.
`<owner-hash>` is lowercase SHA-256 of `issuer + "\u0000" + subject`, matching
the existing resource ID. Use the discovered verified resource when available.

Unknown fields, duplicate plans, aliased source files, missing owners, and
unsupported schemas fail. The importer requires the previous release's current
posting schema, including UUID/pending and execution-order fields. Upgrade an
older disposable backup with that release first. Source files remain unchanged.

Dry-run performs the full migration and verification in a disposable workspace.
It does not publish the destination. Output contains counts, not financial data,
provider tokens, or identity subjects.

The destination must be new. Source databases remain read-only. Failed imports
must not publish a partially migrated application database. A safe rerun starts
with another new destination rather than an implicit conflict merge.

Check the migration report, SQLite integrity, foreign keys, and per-plan row
counts before cutover. Verify canonical revisions, execution order, sync keys,
preferences, and session persistence. Test owner, second-account, guest sample,
stale-resource rejection, and provider-outage behavior.

After validation, point `NET_WORTH_ESTIMATOR_DB` at the destination. Remove the
retired per-plan directory, sample-path, and separate session-path settings from
runtime configuration. Retain the old files as private rollback backups.

## Rollback

Before new writes, stop the new API and restore the previous images and database
configuration. Keep original source files unchanged until the rollback window
ends. Do not point the old application at the shared database.

After new writes, a rollback requires reconciliation or an accepted loss of those
writes. Do not silently restore an older backup over current account data.

## Backups and financial replacement

Treat the whole application database as a credential store. It contains provider
tokens and financial data for every account. A full backup is private and must
never serve as a guest sample or a frontend asset.

A financial replacement selects one explicit plan. It preserves all other plans
and all identity state. Sample publication creates an approved snapshot, not a
live alias. It removes private upstream identities, links, sync times, source
paths, migration history, and projection history from the published content.

Server-level SimpleFIN credentials remain bound to the configured owner's plan.
Other private plans and the sample never inherit those credentials. The global
read-only switch still blocks editor writes.

## Verification

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/dbmigration
backend/scripts/verify.sh ./internal/plans
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Use identical entity IDs, preset names, sync identities, and projection inputs
in two plans. Exercise imports, clears, deletes, reorders, sync, and artifact
eviction. Every result must remain within the selected plan.

The current deployment keeps one API instance and one SQLite writer. This
migration changes ownership and storage layout, not the database engine or the
authorization policy.

## Offline plan replacement

The destination private plan must already exist. Use a separate migrated source
snapshot and stop the application before this operation:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/refreshplan \
  --db /private/application.db \
  --source /private/approved-snapshot.db \
  --source-plan "$SOURCE_PLAN" --plan "$TARGET_PLAN"
```

Use `--sample` instead of `--plan` for approved guest publication. Replacement
discards derived projection artifacts. It preserves destination ownership and
every application identity record. Dev wrappers create a recovery backup first.
Direct command users must take that backup themselves.

The API container includes `setupdb`, `migratedb`, `importcsv`, and `refreshplan` under `/app`.
Run operator tools in a separate stopped-stack maintenance container with the
same non-root user and explicit private volume mounts. Do not use an active
server container for migration or plan replacement.
