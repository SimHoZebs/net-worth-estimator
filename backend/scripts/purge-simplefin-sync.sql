-- SimpleFIN sync cutover purge (mock interlude).
--
-- Intent: mock and real sync rows are intentionally identical
-- (source 'simplefin', sfin-pending-* IDs), so selective mock-only deletion
-- is impossible by design. This script removes ALL sync-owned rows; the
-- first real sync re-inserts fresh checkpoints and the pending snapshot.
-- Owner rows (source 'model') are untouched: model saves already protect
-- them via strip-and-merge, and the sync never writes them.
--
-- Procedure:
--   1. Back up the database file (NET_WORTH_ESTIMATOR_DB).
--   2. Stop the server (or disable the scheduler) so no sync runs mid-purge.
--   3. Preview what will go (uncomment the SELECTs below).
--   4. Run the two DELETEs, e.g.:
--        sqlite3 "$NET_WORTH_ESTIMATOR_DB" < backend/scripts/purge-simplefin-sync.sql
--   5. Unset NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK, set the real access URL +
--      account map, restart, then POST /v1/sync/simplefin (dry-run first).
--
-- Note: this script was tested through equivalent sqlite execution, not the
-- sqlite3 CLI itself; run step 4 verbatim once on a machine with sqlite3
-- before relying on it for cutover.
--
-- Preview (run before deleting):
-- SELECT date, account_id, balance FROM checkpoints WHERE source = 'simplefin' ORDER BY date;
-- SELECT id, source_account_id FROM postings WHERE source = 'simplefin' ORDER BY id;

DELETE FROM postings WHERE source = 'simplefin';
DELETE FROM checkpoints WHERE source = 'simplefin';
