# Bank source normalization

One-time operator script. It rewrites legacy `postings.source` and
`checkpoints.source` values from `simplefin` to the current `banksync`
spelling. The provider identity stays in `posting_sync_keys` and the
checkpoint `provider` column.

## Maintenance window

1. Stop every API writer, including the scheduler.
2. Confirm the database is not being written.
3. Run the script with the real database path:

```sh
backend/scripts/one-time/bank-source/run.sh /data/net-worth-estimator.db
```

The script creates a private `<database>.before-bank-source-<timestamp>`
backup with SQLite's backup API before the update. It runs both updates in
one transaction and fails if any `simplefin` source remains.

## Verify

```sh
sqlite3 -readonly /data/net-worth-estimator.db \
  "SELECT COUNT(*) FROM postings WHERE source = 'simplefin';
   SELECT COUNT(*) FROM checkpoints WHERE source = 'simplefin';"
```

Both counts must be `0`. Start the API only after the check passes.

## Retire

Keep this script until every supported target has run it and verified both
counts. Remove it only after the target release checklist records the
migration and the strict `banksync` matcher is live on every target.
