# Repair claimed posted time (one-time operator script)

Repairs settled bank rows whose posted instant was cleared to zero by a pending
bank refresh while the row was claimed as a recorded occurrence. Pending seeds
and void holds may legally carry no posted date and are never touched.

Neither `setupdb` nor the server calls it. Run it with the API stopped, on a
verified backup copy, before `deploy/migrate.sh` or `setupdb`.

```sh
CGO_ENABLED=0 go -C backend run ./scripts/one-time/repair-claimed-posted-time --db /absolute/path/app.db
```

It copies `transaction_time` into `posted_time` only for rows with
`pending = 0`, `void = 0`, `posted_time <= 0`, and a positive
`transaction_time`. Any settled row without a usable transaction time fails
closed instead of inventing an event time. A database with no such rows is left
unchanged.
