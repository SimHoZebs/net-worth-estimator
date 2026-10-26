# Posting identity and UUID migration

## Runtime contract

Persisted postings use canonical UUIDs. The browser generates UUIDs for new rows.
The store generates UUIDv7 IDs when the caller supplies no ID. Existing canonical
UUIDs remain unchanged. Account and recurrence-rule identifiers are outside this
migration.

Identity carries no ownership or lifecycle meaning. `source` records ownership,
and `pending` records bank lifecycle state. Owner API writes ignore both fields.
The store refuses owner updates and deletes of stored sync-owned postings.

`executionOrder` records the numeric tie-break for equal transaction and posted
times. It is independent of UUIDs and display position. The store assigns it on
creation and preserves it on owner edits and display moves. The upgrade captures
the previous execution sequence before it changes IDs. Historical replay,
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

## One-way schema upgrade

The legacy single-plan schema upgrade applies `posting-uuid-and-pending-v1`
once. It supports the immediately preceding postings schema. Current runtime
storage is plan-scoped in one shared database. Legacy files require the
[offline migration procedure](shared-database.md), not a runtime file merge.

It performs these operations before it records completion:

1. Add explicit pending state and the private upstream identity table.
2. Replace each non-canonical posting ID with a UUIDv7.
3. Preserve every posting's values, ownership, position, execution sequence, and purchase policy.
4. Rewrite model-value and late-fee references in postings, rules, and presets.
5. Rewrite posting ID lists in configured evaluations and financial-independence cashflow `sources[].postingId` references.
6. Rebuild posting entries in the shared ID registry.
7. Clear derived projection artifacts that contain old posting IDs.

The private `posting_id_migrations` table records old-to-new identities. Both included
and excluded cashflow sources retain their posting references. Asset account IDs,
expression input names, and presentation strings stay unchanged. CSV import uses
the same reference-remapping contract. `schema_migrations` records
completion only after all changes succeed. Any failure rolls back the full
transaction and stops startup. Reopening the database preserves the new UUIDs.

The old `sync-pending-` and `sfin-pending-` formats appear only in migration code.
They establish pending state for existing sync-owned rows, not for owner rows.
No runtime save, pending badge, subscription conversion, or purge uses ID prefixes.

## Legacy upstream keys

The old sync mapper replaced characters in transaction keys. The database cannot
recover the exact original keys. The upgrade preserves those pending rows without
inventing upstream identities. The next successful authoritative bank snapshot
replaces that legacy pending set and establishes exact keys. Subsequent repeated
snapshots retain the same UUIDs. Dev sync remains disabled during migration.

## Deployment and recovery

Before deployment, take SQLite-safe backups of the primary, sample, and private
plan databases. Test the upgrade on disposable copies. Compare canonical values
and references through the recorded ID map. Verify deterministic projections,
integrity checks, repeated startup, and repeated sync delivery.

Deploy compatible API and frontend images together through the normal Compose
stack. Identity settings, accounts, sessions, and plan ownership do not change.
Existing browser drafts remain stored. Their old model fingerprint makes them
stale, so users must review them rather than overwrite migrated data automatically.

For rollback, stop the API and restore the database backup with the previous
images. Do not run the old sync writer against the migrated database.
