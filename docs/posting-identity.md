# Posting identity

## Runtime contract

Persisted postings use canonical UUIDs. The browser generates UUIDs for new rows.
The store generates UUIDv7 IDs when the caller supplies no ID. Existing canonical
UUIDs remain unchanged. Account and recurrence-rule identifiers keep their own formats.

Identity carries no ownership or lifecycle meaning. `source` records ownership,
and `pending` records bank lifecycle state. Owner API writes ignore both fields.
The store refuses owner updates and deletes of stored sync-owned postings.

`executionOrder` records the numeric tie-break for equal transaction and posted
times. It is independent of UUIDs and display position. The store assigns it on
creation and preserves it on owner edits and display moves. Historical replay,
deterministic projections, and financial-independence branches share this order.

Within one plan, `posting_sync_keys` maps an exact `(provider, account_id, transaction_id)` tuple
to a local posting UUID. `account_id` is the provider account key, not a sanitized
model identifier. A primary-key constraint makes repeated deliveries idempotent.
Different raw keys such as `a/b`, `a b`, and `a_b` remain distinct. These private
keys never become posting IDs or browser presentation metadata.

The store preserves the UUID when an incoming snapshot includes the same tuple.
It updates financial fields in place. It deletes only absent pending rows for the
provider and model accounts covered by that snapshot. Owner rows and other
providers' rows remain untouched. A dry run rolls back rows, identity keys, and
registry changes together.

CSV replacement preserves stored sync rows and their private identity keys.
Published guest snapshots omit the private keys and migration audit history.

## Legacy upstream keys

The old sync mapper replaced characters in transaction keys. The database cannot
recover the exact original keys. Those pending rows are preserved without
inventing upstream identities. The next successful authoritative bank snapshot
replaces that legacy pending set and establishes exact keys. Subsequent repeated
snapshots retain the same UUIDs. Dev sync remains disabled.

## Deployment and recovery

Before deployment, take a SQLite-safe backup of the application database.
Test setup and schema changes on disposable copies. Compare canonical values
and references. Verify deterministic projections,
integrity checks, repeated startup, and repeated sync delivery.

Deploy compatible API and frontend images together through the normal Compose
stack. Identity settings, accounts, sessions, and plan ownership do not change.
Existing browser drafts remain stored. Their old model fingerprint makes them
stale, so users must review them rather than overwrite current data automatically.

For rollback, stop the API and restore the database backup with the previous
images. Do not run an old server build against the current database.
