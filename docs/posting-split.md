# Posting sim split

Pre-split `postings` rows carry simulation state (`position`, `enabled`,
`execution_order`), the occurrence claim (`fulfills_rule_id`,
`fulfills_occurrence_date`), multi-destination JSON (`destinations`), and a
`receipt_ids` back-reference. Post-split storage is three tables:

- `postings(user_id, id, name, source_account_id, destination_account_ids,
  amount_resolution_json, posted_time, transaction_time, source, pending, void)`
- `posting_sim(user_id, posting_id, position, enabled, execution_order)`
- `posting_claims(user_id, posting_id, fulfills_rule_id, fulfills_occurrence_date)`

Receipt links live only in the `receipts` table. Every postings read that
builds a wire `Posting` uses the shared select/join fragments, ordered by
the satellite position.

## One-time upgrade

`backend/scripts/one-time/posting-sim-split` converts a pre-split database
in place on a stopped-app candidate copy. Follow
[deploy/MIGRATIONS.md](../../deploy/MIGRATIONS.md): back up, convert the
candidate, validate, then publish. Neither the server nor `setupdb` invokes
conversion. Verify with `backend/scripts/verify.sh
./scripts/one-time/posting-sim-split`.

The script fails closed on partial or mixed shapes: every old column must be
present and both satellites absent-or-empty. Each receipt back-reference must
match the receipts table as a set. A repeat run on a completed target is
read-only and converges both analysis lifecycle triggers (pending/void on
postings, enabled on posting_sim) so migrated databases match fresh ones.
Restore the backup to undo.

Run this upgrade before the planned-purchase upgrade on databases that still
store purchases as postings: the purchase eligibility query reads the split
shape with an inner join on `posting_sim`, so a missing satellite fails the
purchase conversion instead of silently skipping rows.

`refreshmodel` copies both satellites as ordinary financial tables. Guest
publication stays receipt-free because the receipts table itself is skipped;
no postings column needs scrubbing anymore.
