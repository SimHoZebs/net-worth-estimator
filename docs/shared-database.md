# Shared application database

## Boundary

`NET_WORTH_ESTIMATOR_DB` names one application SQLite database. It contains all
private users, the approved guest sample, and application sessions and grants.
Casdoor remains the external identity provider with its own state directory.

An application user is a signed-in user. It differs from a financial account
in the model's `accounts` table. `users` records immutable OIDC identities;
the store row ID is the user scope itself. The owner key derives from the
exact verified issuer and subject, not a username or email.

Each financial table carries a non-null `user_id`. Composite keys allow the same
entity IDs and preset names in different users. Composite foreign keys prevent
relational references across users. JSON references validate against the scoped
financial document. The sample uses the synthetic `sample` user.

Deployment owns database creation and schema setup. The running server only opens
an existing, compatible database. A financial store holds
one immutable user ID. The authenticated router resolves access before it creates
that scope. An empty or missing scope never selects a default private user.

Schema migration records are global. Model metadata, sync state, settings,
ordering, presets, identity registries, and artifact retention are user-scoped.
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

New user signup still inserts user and default-preset rows. It does not
create database files or change schema.

## Rollback

Before new writes, stop the API and restore the previous images and database
configuration. Do not silently restore an older backup over current user data.

After new writes, a rollback requires reconciliation or an accepted loss of those
writes. Do not silently restore an older backup over current user data.

## Backups and financial replacement

Treat the whole application database as a credential store. It contains provider
tokens and financial data for every user. A full backup is private and must
never serve as a guest sample or a frontend asset.

A financial replacement selects one explicit user. It preserves all other users
and all identity state. Sample publication creates an approved snapshot, not a
live alias. It removes private upstream identities, links, sync times, source
paths, migration history, and projection history from the published content.

Server-level SimpleFIN credentials remain bound to the configured owner.
Other private users and the sample never inherit those credentials. The global
read-only switch still blocks editor writes.

## Verification

```bash
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/api
backend/scripts/verify.sh
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Use identical entity IDs, preset names, sync identities, and projection inputs
in two users. Exercise imports, clears, deletes, reorders, sync, and artifact
eviction. Every result must remain within the selected user.

The current deployment keeps one API instance and one SQLite writer.

## Offline user replacement

The destination private user must already exist. Use a separate migrated source
snapshot and stop the application before this operation:

```bash
CGO_ENABLED=0 go -C backend run ./cmd/refreshplan \
  --db /private/application.db \
  --source /private/approved-snapshot.db \
  --source-user "$SOURCE_USER" --user "$TARGET_USER"
```

Use `--sample` instead of `--user` for approved guest publication. Replacement
discards derived projection artifacts. It preserves destination ownership and
every application identity record. Dev wrappers create a recovery backup first.
Direct command users must take that backup themselves.

The API container includes `setupdb`, `importcsv`, `refreshplan`, and the
temporary `migrate-plans-to-users` under `/app`.
Run operator tools in a separate stopped-stack maintenance container with the
same non-root user and explicit private volume mounts. Do not use an active
server container for migration or user replacement.
