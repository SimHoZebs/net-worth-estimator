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

When the satellite is absent, the tool creates it and considers existing
**claimed bank rows** only when all of these lifecycle and equality conditions
hold:

- `source NOT IN ('user', 'model', '')`
- `pending = 0` and `void = 0`
- `posted_time > 0`
- `posted_time = transaction_time`

Equality only narrows the candidates. A candidate is marked provisional only
when `transaction_source_facts` exists, the candidate has a facts row, and that
row contains a valid JSON object with both:

- `pending` exactly boolean `true`
- a present numeric `postedTime` exactly equal to zero

Both signals are required because a pending feed item can carry a positive
posted timestamp and a settled item can carry zero. Numeric zero alone is not
proof of pending origin.

Every candidate lacking either signal remains unknown and unmarked. This
includes `pending: false`, an absent or null `pending`, a non-boolean `pending`,
and `pending: true` with a positive posted time. Legacy facts that predate
reliable pending evidence normally carry `pending: false`; the conservative
outcome for those documents is zero backfilled markers. Missing facts, a source
without `transaction_source_facts`, and non-object documents are also unknown.
Data safety wins over guessing: an unknown row keeps its owner-edited values and
participation.

Malformed JSON on an equality candidate fails the whole upgrade closed before
publication. Malformed facts on non-candidates are outside this tool's contract.
Transaction rows are never rewritten.

Future SimpleFIN facts persist `pending` from `Transaction.IsPending()`. Newly
claimed holds already receive an explicit marker at claim time, so their runtime
behavior does not depend on this backfill. When the satellite already exists,
the tool validates its exact shape and marker invariants and leaves every marker
row unchanged. It never reruns candidate classification on later deployments.
This makes an owner's later confirmation stable: clearing a marker is permanent
unless a new pending hold is claimed.

The tool fails closed on a malformed satellite, an invalid marker, integrity
failure, or foreign-key violation.
