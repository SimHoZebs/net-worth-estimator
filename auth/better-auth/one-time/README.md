# One-time identity column retirement

These are offline operator migrations for the Better Auth database. They are
standalone scripts, not part of the auth runtime, and the server never invokes
them.

## Retire `user.disabled`

The disabled-flag capability was deleted from the auth code. An existing
identity database still carries `"user"."disabled"` as `NOT NULL` with no
default, and Better Auth validates the database schema on every API call. While
the column exists, discovery and every other endpoint answer `503`, and inserts
into `user` fail.

Run this before deploying the release whose auth code omits the column. A
database that already lost the column is a no-op.

```sh
AUTH_DATABASE=/data/identity.db bun run auth/better-auth/one-time/retire-user-disabled.ts
AUTH_DATABASE=/data/identity.db bun run auth/better-auth/one-time/retire-user-disabled.ts --apply
```

For PostgreSQL, name the verified dump the operator already holds. The script
refuses to apply without it:

```sh
AUTH_DATABASE="postgresql://…" bun run auth/better-auth/one-time/retire-user-disabled.ts \
  --apply --backup 26-11-23-102140-backup
```

Without `--apply` the script prints the plan and changes nothing. With
`--apply` it verifies the current tables and retained columns, then:

- SQLite: writes a `VACUUM INTO` backup beside the database, applies the drop to
  a candidate copy, checks the column is gone, the user row count and retained
  row digest are unchanged, integrity is `ok`, and there are no foreign key
  violations, then publishes the candidate over the original. The backup stays
  beside the database for operator recovery; nothing restores automatically.
- PostgreSQL: applies the drop inside a transaction and rolls back on any
  failed postcondition, so the live schema and rows are unchanged unless every
  check passes.

Stop every identity writer first. Record the database target, the backup name
or path, the pre- and post-migration `user` columns, the user row count, and the
release run ID in the deployment checklist. Retire this script through
`deploy/MIGRATIONS.md` only after every supported target verifies the upgrade.
