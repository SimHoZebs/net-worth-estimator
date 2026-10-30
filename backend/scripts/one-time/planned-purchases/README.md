# One-time planned-purchase upgrade

This standalone script upgrades a user-scoped `shared-accounts-v1` database that
still stores purchases as postings with `purchase_policies`. It has no imports
from the app or store. The server and `setupdb` never invoke it.

The API image includes the independent executable at
`/app/upgrade-planned-purchases`. The offline deployment hook invokes it only on
a candidate copy after a verified backup. It verifies preservation and publishes
the candidate before API startup. See [the deployment SOP](../../../../deploy/MIGRATIONS.md).

1. Stop every app process that can write this database.
2. Create a consistent, private SQLite backup.
3. Run the script from the repository root:

   ```bash
   CGO_ENABLED=0 go -C backend run ./scripts/one-time/planned-purchases --db /absolute/path/app.db
   CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /absolute/path/app.db
   ```

4. Verify the purchase queue before restart.

The script opens only an explicit existing regular file. It converts all users
in one transaction, preserves purchase IDs and values, and removes the retired
posting rows and policy table. Repeated execution leaves the completed target
unchanged. No environment variable selects a database.

Variable or invalid costs, receipts, bank links, Analysis evidence, claims, and bank-owned rows stop
the upgrade without partial changes. Resolve those records before retry.
Restore the backup to undo a completed upgrade. Do not use an older server with
the new schema.

Verify with disposable databases:

```bash
backend/scripts/verify.sh ./scripts/one-time/planned-purchases
```

Delete this isolated script after its required upgrades are complete. Its frozen
schema is specific to this upgrade, not a reusable migration framework.
