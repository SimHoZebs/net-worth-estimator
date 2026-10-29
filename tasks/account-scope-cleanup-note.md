# Note: plan scope is now account scope (supersedes, does not rewrite)

The history in `tasks/*plan*.md` still describes the plan-scoped design and is
left intact. The storage rekey is documented in
`docs/shared-database.md` (migration), `docs/authorization.md` (resources), and
`TESTING.md` (isolation gate). Decisions that differ from the parallel
workstream's draft:

- Storage scopes are `user:<identity-hash>` for private scopes, `sample` for
  the guest scope, `fixture` for the isolated test harness. Wire session and
  `Waypoint-Resource` IDs stay `plans/*` in this change; the storage layer
  normalizes `plans/<hash>` to the owner's `user:<hash>` scope (`plans/sample`
  and `plans/fixture` to the reserved scopes) for `Database` lookups and
  operator tooling.
- The sample stays: a global read-only approved snapshot under the reserved
  `sample` account with no `app_accounts` row. Guest mode is not dropped.
- `plans` table and its `shared-plans-v1` marker are dropped after backfill, so a
  migrated database claims exactly `shared-accounts-v1`.
- `entity_ids` stays per-account (`PRIMARY KEY(account_id, id)`), not global:
  identical entity IDs must coexist across accounts for the TESTING.md
  same-file isolation proof (same names, same sync keys, same IDs) and so two
  owners can each keep human-readable IDs like `checking`. Model-account
  columns were renamed instead (`model_account_id`, `bridge_account_id`), so
  the scope column never collides with a financial reference.
- Singletons (`model_metadata`, `sync_state`, `sync_credentials`,
  `safe_spending_settings`) keep `id = 1` rows per account.
- Browser state saved under a different resource key is never restored into
  the current scope (orphaned under its old key, never adopted). No draft
  migration or deletion runs; the frontend namespaces by verified resource.
