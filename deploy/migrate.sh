#!/bin/sh
# The one replaceable migration body for every deployment. See MIGRATIONS.md.
# The deployment adapter stops API writers and supplies this image's environment
# and durable data mount. Never invoke this script from server startup.
# Pending: add Analysis evidence, findings, and private feedback to current storage.
# Retain this body until every supported target verifies this release.
set -eu
umask 077
PATH="/app:$PATH"
export PATH
: "${NET_WORTH_ESTIMATOR_DB:?NET_WORTH_ESTIMATOR_DB is required}"
db=$NET_WORTH_ESTIMATOR_DB
pending="${db}.analysis-migration-pending"
fail() { echo "$1" >&2; exit 1; }
test -f "$db" || fail "Analysis migration requires an existing application database."
case "$db" in *"'"*) fail "Analysis migration requires a database path without single quotes." ;; esac

check_integrity() {
  integrity=$(sqlite3 -readonly "$1" 'PRAGMA integrity_check;') || return 1
  test "$integrity" = ok || return 1
  foreign_keys=$(sqlite3 -readonly "$1" 'PRAGMA foreign_key_check;') || return 1
  test -z "$foreign_keys"
}
check_target() {
  sqlite3 -readonly "$db" '
    SELECT user_id, posting_id, facts_json FROM transaction_source_facts LIMIT 0;
    SELECT user_id, revision FROM analysis_inputs LIMIT 0;
    SELECT user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json FROM analysis_runs LIMIT 0;
    SELECT user_id, id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision FROM analysis_findings LIMIT 0;
    SELECT user_id, id, request_id, finding_id, run_id, created_at, payload_json FROM analysis_feedback LIMIT 0;' || return 1
  test "$(sqlite3 -readonly "$db" "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name IN ('analysis_facts_insert','analysis_facts_update','analysis_facts_delete','analysis_posting_lifecycle');")" = 4 || return 1
  test "$(sqlite3 -readonly "$db" "SELECT count(*) FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');")" = 2
}

check_integrity "$db" || fail "Application database integrity check failed."
test "$(sqlite3 -readonly "$db" "SELECT count(*) FROM schema_migrations WHERE name='shared-accounts-v1';")" = 1 || fail "Unsupported application schema."
# Freeze the supported pre-Analysis schema here, not in a backend migration chain.
sqlite3 -readonly "$db" '
  SELECT user_id, id, posting_id, digest, size, blob_key, revision, payload FROM receipts LIMIT 0;
  SELECT key, state, expires_at FROM blob_objects LIMIT 0;
  SELECT key, data FROM blob_data LIMIT 0;
  SELECT token, data, expiry FROM sessions LIMIT 0;
  SELECT id, issuer, subject, sid, expiry, data FROM identity_grants LIMIT 0;
  SELECT issuer, kind, identifier, seen_at, expiry FROM identity_logout_marks LIMIT 0;
  SELECT issuer, jti, expiry FROM identity_logout_tokens LIMIT 0;
  SELECT id, issuer, subject FROM users LIMIT 0;
  SELECT id, name, created_by_user_id, created_at FROM user_groups LIMIT 0;
  SELECT group_id, user_id, role, joined_at, display_name FROM group_members LIMIT 0;
  SELECT id, group_id, code_hash, created_by_user_id, expires_at, max_uses, used_count, revoked_at, created_at FROM group_invites LIMIT 0;
  SELECT user_id, id, position, name, kind, min_balance, max_balance, color, enabled FROM accounts LIMIT 0;
  SELECT user_id, id, position, date, model_account_id, balance, source FROM checkpoints LIMIT 0;
  SELECT user_id, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, receipt_ids FROM postings LIMIT 0;
  SELECT user_id, provider, bridge_account_id, transaction_id, posting_id FROM posting_sync_keys LIMIT 0;
  SELECT user_id, old_id, new_id FROM posting_id_migrations LIMIT 0;
  SELECT user_id, posting_id, priority FROM purchase_policies LIMIT 0;
  SELECT user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled FROM recurrence_rules LIMIT 0;
  SELECT user_id, type, instance_id, position, name, enabled, config_json FROM evaluations LIMIT 0;
  SELECT user_id, identity, kind, created_at, payload FROM projection_artifacts LIMIT 0;
  SELECT user_id, id, source_path, document_present FROM model_metadata LIMIT 0;
  SELECT user_id, model_account_id, position, minimum_fixed, minimum_percent, due_day, statement_day FROM payment_terms LIMIT 0;
  SELECT user_id, id, kind FROM entity_ids LIMIT 0;
  SELECT user_id, bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at FROM account_links LIMIT 0;
  SELECT user_id, instance_id, position FROM pinned_evaluations LIMIT 0;
  SELECT user_id, id, settings_json FROM safe_spending_settings LIMIT 0;
  SELECT user_id, id, last_sync_at FROM sync_state LIMIT 0;
  SELECT user_id, id, access_url, bridge_host, updated_at, cards_json FROM sync_credentials LIMIT 0;
  SELECT user_id, id, position, name, label, summary, when_use, amount_json, enabled FROM amount_presets LIMIT 0;
' || fail "Incomplete application schema. Refusing automatic repair."
count=$(sqlite3 -readonly "$db" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('transaction_source_facts','analysis_inputs','analysis_runs','analysis_findings','analysis_feedback');")
case "$count" in
  5)
    check_target || fail "Incomplete Analysis schema. Refusing automatic repair."
    test ! -e "$pending" || fail "Unverified prior Analysis migration. Restore or verify its backup before retry."
    exit 0 ;;
  0) ;;
  *) fail "Partial Analysis schema. Refusing automatic repair." ;;
esac

# The adapter already stopped all writers. The backup remains private and unique
# on every attempt, including a failed setup. No automatic rollback resumes API.
backup=$(mktemp -d "${db}.analysis-backup.XXXXXX")
sqlite3 "$db" ".backup '$backup/before.db'"
check_integrity "$backup/before.db" || fail "Analysis backup verification failed."
printf '%s\n' "$backup/before.db" > "$pending"
tables=$(sqlite3 -readonly "$backup/before.db" "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations' ORDER BY name;")
for table in $tables; do
  case "$table" in *[!a-z0-9_]*) fail "Unsupported application table name." ;; esac
done
setupdb --db "$db"
check_target || fail "Analysis schema verification failed. Keep the API stopped."
check_integrity "$db" || fail "Migrated database integrity check failed."
for table in $tables; do
  changed=$(sqlite3 -readonly "$db" "ATTACH DATABASE '$backup/before.db' AS before;
    SELECT (SELECT count(*) FROM main.$table)!=(SELECT count(*) FROM before.$table)
      OR EXISTS(SELECT * FROM main.$table EXCEPT SELECT * FROM before.$table)
      OR EXISTS(SELECT * FROM before.$table EXCEPT SELECT * FROM main.$table);")
  test "$changed" = 0 || fail "Analysis migration changed existing application rows. Keep the API stopped."
done
rm "$pending"
