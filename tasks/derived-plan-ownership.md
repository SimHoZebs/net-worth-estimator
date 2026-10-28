# Derive plan ownership from parent entities

Status: backlog. Requested after the receipt storage review on 2026-10-27.

The user deferred both the global posting-identity prerequisite and receipt
ownership cleanup on 2026-10-27. Keep the current receipt schema and runtime
behavior until this task is scheduled.

Remove redundant `plan_id` columns from dependent tables. Store ownership once
at the appropriate aggregate root. Derive authorization scope through explicit
parent relationships. Keep plan ownership where no parent supplies it.

## Identity prerequisite

Generated UUIDv7 values are effectively globally unique. The current persistence
contract still permits the same stored entity ID in different plans. Copies can
preserve UUIDs without a generator collision.

- `backend/internal/store/schema.go` keys postings by `(plan_id, id)`.
- `backend/cmd/refreshplan/main.go` copies IDs unchanged into another private
  plan or the public sample.
- `backend/internal/store/database_test.go` explicitly tests two plans with the
  same posting UUID in one database.
- `backend/internal/store/receipt_schema.go` uses that composite parent key.

Before a receipt can refer to a transaction by UUID alone, enforce globally
unique posting IDs. Define copy/import identity semantics and handle existing
duplicates. A new independent copy needs new IDs and a complete reference map.
The source data must remain unchanged. A refresh of the same logical workspace
must have an explicit identity-preservation contract.

Do not remove a scope predicate while the parent ID remains ambiguous. Do not
move the duplicate ownership field into JSON or a new association table merely
to remove the column.

## Change

1. Establish global posting identity before normalizing receipt ownership.
2. Give receipts a globally unique primary key and a single posting foreign key.
3. Derive receipt access, quotas, deduplication, and cleanup from its posting.
4. Audit the remaining tables for ownership that a parent already supplies.
5. Normalize each eligible relationship in a separate, reviewable change.
6. Preserve direct ownership on roots and plan-level singleton records.

Account, recurrence-rule, and evaluation identifiers do not all follow the
posting UUID contract. Inventory their formats and references before changing
their keys. Cover SQL references, JSON references, ID registries, sync keys,
evaluation configuration, receipts, and copy/import workflows.

Use explicit offline schema migrations. Keep runtime startup read-only with
respect to schema setup. Rebuild affected foreign keys and indexes atomically.
Document backups, compatibility checks, and rollback through a compatible
backup. Do not migrate a live database as part of task grooming.

## Verification

- Verify global uniqueness with database constraints, including caller-supplied
  UUIDs and existing duplicate IDs.
- Verify copy/import remapping and all dependent references in one transaction.
- Verify source immutability, repeat refreshes, and public-sample privacy.
- Test denied reads and every mutation across two owners in one database.
- Test receipt quotas, deduplication, posting edits, deletion, and plan clearing.
- Preserve receipt data, financial values, and execution order during migration.
- Verify migration rollback, repeat setup, foreign-key integrity, and restart.
- Run the backend completion gate and affected real-HTTP browser tests.

The receipt column removal depends on the global posting-identity prerequisite.
The broader ownership cleanup must not become an unbounded receipt refactor.
