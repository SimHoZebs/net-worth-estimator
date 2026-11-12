# One-time no-op checkpoint prune

This standalone script removes historical forward bank checkpoints whose
posted balance matches the modeled balance at their instant. Such a
checkpoint sets the balance to the value it already has, so it reconciles
nothing and need not occupy a row. The runtime sync path already skips these
rows for new observations; this tool prunes rows that predate that guard.
It has no imports from the server runtime path. The server and `setupdb`
never invoke it.

The API image includes the independent executable at
`/app/prune-noop-checkpoints`. The offline deployment hook invokes it on a
candidate copy after a verified backup. See [the deployment SOP](../../../../deploy/MIGRATIONS.md).

1. Stop every app process that can write this database.
2. Create a consistent, private SQLite backup.
3. Run the script from the repository root:

   ```bash
   CGO_ENABLED=0 go -C backend run ./scripts/one-time/noop-checkpoints --db /absolute/path/app.db
   CGO_ENABLED=0 go -C backend run ./cmd/setupdb --db /absolute/path/app.db
   ```

4. Verify the checkpoint history before restart.

The script opens only an explicit existing regular file. It processes all
users with checkpoints in two phases: a read-only pass computes every
deletable row, then deletions run per user through the tested store path.
A model that cannot be replayed skips that user without deleting anything;
first observations, owner-authored rows, and forward observations carrying a
changed available balance are always kept. Intermediate zero-delta rows are
safe to remove in chronological order because setting the balance to its
modeled value is a replay no-op. Repeated
execution deletes nothing further. A `--dry-run` flag reports deletable rows
without deleting. Restore the backup to undo a completed prune. Do not use
an older server with the new data.

Verify with disposable databases:

```bash
backend/scripts/verify.sh ./scripts/one-time/noop-checkpoints
```

Retain this isolated script until the migration SOP confirms every supported
target has verified the prune. Do not declare conversions complete or retire
this script from a single host.
