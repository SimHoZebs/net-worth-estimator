-- SimpleFIN sync purge.
--
-- Intent: removes SimpleFIN-owned rows in one explicitly selected account; the
-- next sync re-inserts fresh checkpoints and the pending snapshot.
-- Owner rows (source 'model') are untouched: model saves already protect
-- them via strip-and-merge, and the sync never writes them.
--
-- Procedure:
--   1. Back up the database file (NET_WORTH_ESTIMATOR_DB).
--   2. Stop the server (or disable the scheduler) so no sync runs mid-purge.
--   3. Set :account_id to the verified account scope and preview the selected rows.
--   4. Run this transaction against the current schema, e.g.:
--        sqlite3 -cmd ".parameter init" \
--          -cmd ".parameter set :account_id 'user/<verified-account-hash>'" \
--          "$NET_WORTH_ESTIMATOR_DB" < backend/scripts/purge-simplefin-sync.sql
--   5. Set the real access URL +
--      Access URL, restart, then POST /v1/sync/simplefin.
--
-- SQLite and CLI checks cover account isolation, an omitted binding, and cascades.
--
-- Preview (run before deleting):
-- SELECT date, model_account_id, balance FROM checkpoints WHERE account_id = :account_id AND source = 'simplefin' ORDER BY date;
-- SELECT id, source_account_id FROM postings WHERE account_id = :account_id AND source = 'simplefin' ORDER BY id;
-- An omitted :account_id matches no rows. There is no all-accounts fallback.

PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM posting_sync_keys WHERE account_id = :account_id AND provider = 'simplefin';
DELETE FROM entity_ids WHERE account_id = :account_id AND id IN (
    SELECT id FROM postings WHERE account_id = :account_id AND source = 'simplefin'
);
DELETE FROM postings WHERE account_id = :account_id AND source = 'simplefin';
DELETE FROM checkpoints WHERE account_id = :account_id AND source = 'simplefin';
-- Reset the last-sync timestamp so the sidebar does not report a stale
-- time against an empty sync state. The next successful sync re-stamps it.
UPDATE sync_state SET last_sync_at = '' WHERE account_id = :account_id;
COMMIT;
