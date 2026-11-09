# Payment-pattern upgrade

This is a required one-time operator step for an existing income deployment,
not a runtime compatibility path. New empty databases need no upgrade.

1. Stop API and analysis writers. Resolve any running analysis claim first.
2. Run `python3 upgrade.py APPLICATION.db NEW-PRIVATE-BACKUP.db` using this
   directory's script. It creates a mode-0600 SQLite backup before a single
   transaction changes finding ownership from `income` to `payments` and the
   current summary property from `income` to `pattern`. Existing finding IDs,
   reviews, dismissal, revisions and immutable feedback payloads survive.
   It removes obsolete live provider requests/results, leaving the old version
   stale until the new worker recomputes. Financial rows are untouched.
3. Set the existing `INCOME_MODEL_PATH` deployment setting to a **new** private
   path, for example `/data/payments.sqlite3`. Preserve the old learner database
   as an archive. Its feature space cannot be reused by the generic classifier.
   No runtime conversion or automatic destructive reset is performed. The
   deployment variable name is unchanged; it now addresses the shared learner.
4. Start the reviewed target. Verify fresh `payments-v1/` findings, preserved
   answers and IDs, ready judgments, and `/readyz` returning `ok`.

The generic learner starts cold. Old immutable income feedback remains in the
application audit but is not replayed as a fabricated new-contract answer.
New answers and corrections train the shared deployment learner. Roll back by
stopping writers, restoring the verified application backup, pointing at the
archived learner, and starting the previous image. Never roll back over newer
user edits without reconciling them.

Retain this tool until every supported target records verification in
`deploy/MIGRATIONS.md`. This change is not safe to auto-release to an existing
income target before the operator window is complete.
