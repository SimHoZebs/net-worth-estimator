# Repair claimed posted time (one-time operator script)

Repairs settled bank rows whose posted instant was cleared to zero by a pending
bank refresh while the row was claimed as a recorded occurrence. Pending seeds,
void holds, and owner-authored rows are never touched.

`deploy/migrate.sh` runs this tool on the verified candidate copy after the
transaction satellite split and before provisional-posting backfill. The tool
publishes nothing itself: a failed candidate repair leaves the original database
byte-identical and retains the verified backup.

For an explicit stopped-API recovery or rehearsal, run the target-image binary
against a verified backup copy. Add `--dry-run` to count repairable rows without
writing.

```sh
/app/repair-claimed-posted-time --db /absolute/path/app.db --dry-run
/app/repair-claimed-posted-time --db /absolute/path/app.db
```

From a source checkout, the equivalent command is:

```sh
CGO_ENABLED=0 go -C backend run ./scripts/one-time/repair-claimed-posted-time --db /absolute/path/app.db
```

It copies `transaction_time` into `posted_time` only for bank rows with
`pending = 0`, `void = 0`, `posted_time <= 0`, and a positive
`transaction_time`. Any settled bank row without a usable transaction time fails
closed instead of inventing an event time. A database with no such rows is left
unchanged. A hot rollback journal or non-regular database path is refused.
