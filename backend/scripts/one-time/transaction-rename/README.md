# Transaction rename (one-time operator script)

Renames stored vocabulary to transactions for pre-rename databases.
Neither `setupdb` nor the server calls it. Run it with the API stopped,
on a verified backup copy, before `deploy/migrate.sh` or `setupdb`.

```sh
CGO_ENABLED=0 go -C backend run ./scripts/one-time/transaction-rename --db /absolute/path/app.db
```

The image provides the same tool as `/app/upgrade-transaction-rename`.

It renames the legacy tables and columns and stored JSON keys to
`transactions` vocabulary, rewrites `entity_ids`
`kind` and `evaluations.type` for fulfillment, and recreates the
analysis lifecycle triggers. The upstream bank key column becomes
`bank_transaction_id` so it does not collide with the local
`transaction_id`. A database that already carries `transactions`
is left unchanged.
