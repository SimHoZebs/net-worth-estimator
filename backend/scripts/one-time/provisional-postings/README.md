# Provisional posting satellite (one-time operator tool)

Creates `transaction_provisional_postings(user_id, transaction_id)` for databases
written before explicit provisional-posting state existed. A marker means a
claimed bank hold's positive `posted_time` is still the provisional copy of its
occurred time. The application reads the marker through an `EXISTS` subquery;
the field never crosses the JSON API.

Neither `setupdb` nor the server calls this tool. `deploy/migrate.sh` invokes it
on the verified candidate copy after the transaction satellite split and before
current-schema validation. The original database is not mutated unless the
whole candidate passes verification and is published.

```sh
CGO_ENABLED=0 go -C backend run ./scripts/one-time/provisional-postings --db /absolute/path/app.db
```

Run a standalone invocation only with every API writer stopped and against the
same verified-backup procedure used by the deployment migration body.

## Legacy backfill and ambiguity

When the satellite is absent, the tool creates it and marks existing **claimed
bank rows** that satisfy all of:

- `source NOT IN ('user', 'model', '')`
- `pending = 0` and `void = 0`
- `posted_time > 0`
- `posted_time = transaction_time`

The prior runtime copied occurred time to posted time when claiming a hold but
did not persist whether that instant was provisional. Equality is therefore the
only available inference for legacy rows. It cannot distinguish a hold whose
posted instant was copied from occurred time from a settled charge, or an
owner-edited posted date, that happens to use the same instant. The backfill
marks those ambiguous legacy rows so the first real same-key bank posting can
replace them.

When the satellite already exists, the tool validates its exact shape and marker
invariants and leaves every marker row unchanged. It never reruns the equality
heuristic on later deployments. This makes an owner's later confirmation stable:
clearing a marker is permanent unless a new pending hold is claimed.

The tool fails closed on a malformed satellite, an invalid marker, integrity
failure, or foreign-key violation. Transaction rows are never rewritten.
