-- SimpleFIN sync purge.
--
-- Intent: removes SimpleFIN-owned rows in one explicitly selected user; the
-- next sync re-inserts fresh checkpoints and the pending snapshot.
-- Owner rows (source 'model') are untouched: model saves already protect
-- them via strip-and-merge, and the sync never writes them.
--
-- Procedure:
--   1. Back up the database file (NET_WORTH_ESTIMATOR_DB).
--   2. Stop the server (or disable the scheduler) so no sync runs mid-purge.
--   3. Set :user_id to the verified user scope and preview the selected rows.
--   4. Run this transaction against the current schema, e.g.:
--        sqlite3 -cmd ".parameter init" \
--          -cmd ".parameter set :user_id 'user/<verified-user-hash>'" \
--          "$NET_WORTH_ESTIMATOR_DB" < backend/scripts/purge-simplefin-sync.sql
--   5. Set the real access URL +
--      Access URL, restart, then POST /v1/sync/simplefin.
--
-- SQLite and CLI checks cover user isolation, an omitted binding, and cascades.
--
-- Preview (run before deleting):
-- SELECT date, model_account_id, balance FROM checkpoints WHERE user_id = :user_id AND source = 'simplefin' ORDER BY date;
-- SELECT id, source_account_id FROM postings WHERE user_id = :user_id AND source = 'simplefin' ORDER BY id;
-- An omitted :user_id matches no rows. There is no all-users fallback.

PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM posting_sync_keys WHERE user_id = :user_id AND provider = 'simplefin';
DELETE FROM entity_ids WHERE user_id = :user_id AND id IN (
    SELECT id FROM postings WHERE user_id = :user_id AND source = 'simplefin'
);
DELETE FROM postings WHERE user_id = :user_id AND source = 'simplefin';
DELETE FROM checkpoints WHERE user_id = :user_id AND source = 'simplefin';
-- Reset the last-sync timestamp so the sidebar does not report a stale
-- time against an empty sync state. The next successful sync re-stamps it.
UPDATE sync_state SET last_sync_at = '' WHERE user_id = :user_id;
COMMIT;
