# One-time column removals for invisible computed fields

These are offline operator migrations for the removal of computed fields that
were written but never read. They are standalone scripts, not part of the
backend and not called from server startup. Run them from the reviewed target
image with every API writer stopped and the real durable database mounted.

Both scripts are idempotent: a database that already has the target shape is a
no-op, and a partial column group fails closed before any backup or mutation.
Each verifies the source, writes a private verified backup beside the database,
applies the drop to a candidate copy, checks retained rows and integrity, and
only then publishes the candidate with SQLite's backup API. The backup is
retained for operator recovery; nothing restores automatically.

## Order

Run `drop-analysis-run-input-json.sh` before deploying the release that stops
writing `input_json`. Existing databases still carry that `NOT NULL` column, so
the new claim INSERT fails until the column is removed. The Monte Carlo script
has no such ordering constraint because every dropped column has a default.

## Commands

```sh
NET_WORTH_ESTIMATOR_DB=/data/waypoint.db /app/one-time/drop-analysis-run-input-json.sh
NET_WORTH_ESTIMATOR_DB=/data/waypoint.db /app/one-time/drop-monte-carlo-summary-columns.sh
```

Record the backup paths, pre- and post-migration schema, hashes, target, and
release run ID in the deployment checklist. Do not retire these scripts until
every supported target has verified the upgrade.
