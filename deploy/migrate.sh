#!/bin/sh
# The one replaceable migration body for every deployment. See MIGRATIONS.md.
# The deployment adapter stops API writers and supplies this image's environment
# and durable data mount. Never invoke this script from server startup.
#
# This body performs one combined offline upgrade:
#   1. Legacy date-only balance checkpoints become exact UTC day-close
#      observation instants (23:59:59 UTC of their own Gregorian day), and
#      legacy default-disabled settled bank rows recover their posted-time
#      event times, all inside a single candidate transaction.
#   2. Frozen SQL provisions Analysis on that candidate when needed.
#   3. The standalone purchase tool converts retired purchase policies.
#      setupdb then validates the complete candidate without upgrades.
# The verified candidate is then published over the original database with
# SQLite's backup API. The original file is never mutated before publication:
# every conversion, setup, and postcondition failure leaves the original
# byte-identical with the verified backup retained for operator recovery.
# No automatic restore ever runs, journals are never removed by this body,
# and no migration registry, numbered chain, or historical-model converter
# lives in the backend.
#
# Supported sources are the full `shared-accounts-v1` base with either
# checkpoint shape (deployed date-only, or final observation instants) and
# with zero or all five Analysis tables. Partial Analysis schemas, unknown
# checkpoint shapes (including a date+observed_at mix, which was never
# deployed), pre-user-scope tables, malformed or NULL or normalized-invalid
# dates, and missing or non-integer or non-positive posted instants all fail
# closed before any backup or mutation. A complete target (final checkpoints
# plus the full Analysis schema) repeats read-only checks only and never
# reactivates a post-upgrade owner disable. An absent database file fails:
# provisioning fresh storage is `setupdb` and `render-free-boot.sh`, not
# this hook.
#
# The published `<database>.analysis-migration-pending` interlock from an
# actual previous attempt is recognized fail-closed; this body never creates
# a new interlock or registry file.
set -eu
umask 077
# Resolve this image's setupdb and sqlite3 without overriding a caller that
# deliberately shadows setupdb (for example a rehearsal failure stub).
PATH="$PATH:/app"
export PATH
: "${NET_WORTH_ESTIMATOR_DB:?migrate: NET_WORTH_ESTIMATOR_DB is required}"
db=$NET_WORTH_ESTIMATOR_DB
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pending="${db}.analysis-migration-pending"

fail() { printf 'migrate: %s\n' "$1" >&2; exit 1; }
info() { printf 'migrate: %s\n' "$1"; }
esc() { printf '%s' "$1" | sed "s/'/''/g"; }

test -f "$db" || fail "Migration requires an existing application database."
case "$db" in *"'"*) fail "Migration requires a database path without single quotes." ;; esac
test ! -e "$pending" || fail "Unverified prior Analysis migration. Restore or verify its backup before retry."
# A hot rollback journal means an interrupted writer: refuse. WAL sidecars
# alone are normal (this storage runs in WAL mode) and the backup API reads
# them consistently, so only the rollback journal gates startup here.
test ! -e "$db-journal" || fail "Database is not quiescent ($db-journal exists): stop every writer and retry."

table_count=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';") \
  || fail "Cannot inspect database; refusing to guess."
case "$table_count" in ''|*[!0-9]*) fail "Cannot inspect database; refusing to guess." ;; esac
has_checkpoints=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints';") \
  || fail "Cannot inspect database; refusing to guess."
if [ "$has_checkpoints" != "1" ]; then
  if [ "$table_count" = "0" ]; then
    fail "Database has no tables; run setupdb before migrating."
  fi
  fail "Checkpoints table is missing from a nonempty database; refusing to guess."
fi

check_integrity() {
  integrity=$(sqlite3 -readonly "$1" 'PRAGMA integrity_check;') || return 1
  test "$integrity" = ok || return 1
  violations=$(sqlite3 -readonly "$1" 'SELECT COUNT(*) FROM pragma_foreign_key_check;') || return 1
  test "$violations" = 0
}

# Freeze the supported shared base here, not in a backend migration chain.
# Checkpoints are dispatched separately: the deployed date-only shape and
# the final observation-instant shape are both supported sources.
check_base_columns() {
  sqlite3 -readonly "$1" '
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
  SELECT user_id, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, receipt_ids FROM postings LIMIT 0;
  SELECT user_id, provider, bridge_account_id, transaction_id, posting_id FROM posting_sync_keys LIMIT 0;
  SELECT user_id, old_id, new_id FROM posting_id_migrations LIMIT 0;
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
  SELECT user_id, id, position, name, label, summary, when_use, amount_json, enabled FROM amount_presets LIMIT 0;'
}

check_target() {
  sqlite3 -readonly "$1" '
    SELECT user_id, posting_id, facts_json FROM transaction_source_facts LIMIT 0;
    SELECT user_id, revision FROM analysis_inputs LIMIT 0;
    SELECT user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json FROM analysis_runs LIMIT 0;
    SELECT user_id, id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision FROM analysis_findings LIMIT 0;
    SELECT user_id, id, request_id, finding_id, run_id, created_at, payload_json FROM analysis_feedback LIMIT 0;' || return 1
  test "$(sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name IN ('analysis_facts_insert','analysis_facts_update','analysis_facts_delete','analysis_posting_lifecycle');")" = 4 || return 1
  test "$(sqlite3 -readonly "$1" "SELECT count(*) FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');")" = 2
}

analysis_count() {
  sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('transaction_source_facts','analysis_inputs','analysis_runs','analysis_findings','analysis_feedback');"
}

cp_cols() {
  sqlite3 -readonly "$1" "SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_table_info('checkpoints') ORDER BY cid LIMIT -1);"
}

# Scoped row key, in order: exactly PRIMARY KEY(user_id, id).
scoped_pk() {
  sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_index_list('checkpoints') i WHERE i.origin = 'pk' AND (SELECT COUNT(*) FROM pragma_index_info(i.name)) = 2 AND (SELECT name FROM pragma_index_info(i.name) WHERE seqno = 0) = 'user_id' AND (SELECT name FROM pragma_index_info(i.name) WHERE seqno = 1) = 'id';"
}

# Exact non-partial unique column set, order independent.
exact_unique() {
  sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_index_list('checkpoints') i WHERE i.\"unique\" = 1 AND i.partial = 0 AND (SELECT COUNT(*) FROM pragma_index_info(i.name)) = 3 AND (SELECT COUNT(*) FROM pragma_index_info(i.name) WHERE name IN ('$2', '$3', '$4')) = 3;"
}

users_fk() {
  sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_foreign_key_list('checkpoints') WHERE \"table\" = 'users' AND \"from\" = 'user_id' AND \"to\" = 'id';"
}

final_fks_ok() {
  total=$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_foreign_key_list('checkpoints');") || return 1
  test "$total" = 3 || return 1
  matched=$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_foreign_key_list('checkpoints') WHERE (\"table\", \"from\", \"to\") IN (('users', 'user_id', 'id'), ('accounts', 'user_id', 'user_id'), ('accounts', 'model_account_id', 'id'));") || return 1
  test "$matched" = 3
}

LEGACY_COLS="user_id,id,position,date,model_account_id,balance,source"
FINAL_COLS="user_id,id,position,model_account_id,balance,source,observed_at"

check_integrity "$db" || fail "Application database integrity check failed."

cols=$(cp_cols "$db") || fail "Cannot inspect checkpoints shape; refusing to guess."
case "$cols" in
  *user_id*) ;;
  *) fail "Checkpoints lack user scoping; unsupported pre-user-scope database." ;;
esac

marker=$(sqlite3 -readonly "$db" "SELECT count(*) FROM schema_migrations WHERE name='shared-accounts-v1';") \
  || fail "Cannot inspect schema marker; refusing to guess."
test "$marker" = 1 || fail "Unsupported application schema."
check_base_columns "$db" || fail "Incomplete application schema. Refusing automatic repair."

purchases=$(sqlite3 -readonly "$db" "SELECT group_concat(name, ',') FROM (SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('purchase_policies','planned_purchases') ORDER BY name);")
case "$purchases" in
  purchase_policies)
    sqlite3 -readonly "$db" 'SELECT user_id, posting_id, priority FROM purchase_policies LIMIT 0;' || fail "Incomplete purchase schema." ;;
  planned_purchases)
    sqlite3 -readonly "$db" 'SELECT user_id, id, position, name, funding_account_id, cost, earliest_date, priority, enabled FROM planned_purchases LIMIT 0;' || fail "Incomplete purchase schema." ;;
  *) fail "Unknown or mixed purchase schema. Refusing automatic repair." ;;
esac

analysis=$(analysis_count "$db") || fail "Cannot inspect Analysis schema; refusing to guess."
case "$analysis" in
  0|5) ;;
  *) fail "Partial Analysis schema. Refusing automatic repair." ;;
esac
if [ "$analysis" = 5 ]; then
  check_target "$db" || fail "Incomplete Analysis schema. Refusing automatic repair."
fi

mode=""
if [ "$cols" = "$LEGACY_COLS" ]; then
  mode="convert"
elif [ "$cols" = "$FINAL_COLS" ]; then
  mode="verify"
else
  fail "Checkpoints have unexpected shape ($cols); refusing to guess."
fi

if [ "$mode" = convert ]; then
  pk=$(scoped_pk "$db") || fail "Cannot inspect checkpoints key; refusing to guess."
  test "$pk" = 1 || fail "Checkpoints lack the scoped row key; refusing to guess."
  uniq=$(exact_unique "$db" user_id model_account_id date) || fail "Cannot inspect checkpoints index; refusing to guess."
  test "$uniq" -ge 1 || fail "Checkpoints lack the deployed date-only unique index; refusing to guess."
  fk=$(users_fk "$db") || fail "Cannot inspect checkpoints keys; refusing to guess."
  test "$fk" -ge 1 || fail "Checkpoints lack the user foreign key; refusing to guess."
  ppk=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_index_list('postings') i WHERE i.origin = 'pk' AND (SELECT COUNT(*) FROM pragma_index_info(i.name)) = 2 AND (SELECT name FROM pragma_index_info(i.name) WHERE seqno = 0) = 'user_id' AND (SELECT name FROM pragma_index_info(i.name) WHERE seqno = 1) = 'id';") \
    || fail "Cannot inspect postings key; refusing to guess."
  test "$ppk" = 1 || fail "Postings lack user scoping; refusing legacy unscoped repair."
  bad_dates=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM checkpoints WHERE \"date\" IS NULL OR \"date\" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(\"date\") IS NULL OR date(\"date\") != \"date\" OR CAST(strftime('%s', \"date\" || ' 23:59:59') AS INTEGER) IS NULL OR CAST(strftime('%s', \"date\" || ' 23:59:59') AS INTEGER) <= 0 OR date(CAST(strftime('%s', \"date\" || ' 23:59:59') AS INTEGER), 'unixepoch') != \"date\";") \
    || fail "Cannot validate checkpoint dates; refusing to guess."
  test "$bad_dates" = 0 || fail "Refusing to invent timestamps: $bad_dates checkpoint rows lack a calendar day."
  bad_posted=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM postings WHERE source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND (posted_time IS NULL OR typeof(posted_time) != 'integer' OR posted_time <= 0);") \
    || fail "Cannot validate bank posted instants; refusing to guess."
  test "$bad_posted" = 0 || fail "$bad_posted settled bank rows lack a posted instant; refusing to invent event times."
else
  pk=$(scoped_pk "$db") || fail "Cannot inspect checkpoints key; refusing to guess."
  test "$pk" = 1 || fail "Checkpoints lack the scoped row key; refusing to guess."
  uniq=$(exact_unique "$db" user_id model_account_id observed_at) || fail "Cannot inspect checkpoints index; refusing to guess."
  test "$uniq" -ge 1 || fail "Checkpoints lack the observation-instant unique index; refusing to guess."
  final_fks_ok "$db" || fail "Checkpoints lack the account foreign keys; refusing to guess."
  bad=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM checkpoints WHERE observed_at IS NULL OR typeof(observed_at) != 'integer' OR observed_at <= 0;") \
    || fail "Cannot verify observation instants; refusing to report verified."
  test "$bad" = 0 || fail "$bad checkpoint rows have invalid observed_at; refusing to report verified."
fi

# A complete target repeats read-only checks only: no backup, no writes,
# and post-upgrade owner disables of settled bank rows stay exactly as-is.
if [ "$mode" = verify ] && [ "$analysis" = 5 ] && [ "$purchases" = planned_purchases ]; then
  info "Checkpoints already carry observation instants with complete Analysis schema; verified, nothing to do."
  exit 0
fi

# Snapshot the original with the SQLite backup API into a new private
# directory on the same durable mount. The candidate is built from the
# verified snapshot; the original file is untouched until publication.
backup=$(mktemp -d "${db}.analysis-backup.XXXXXX") || fail "Cannot create a private backup directory."
before="$backup/before.db"
sqlite3 -readonly "$db" ".backup '$(esc "$before")'" || fail "Backup copy failed."
check_integrity "$before" || fail "Backup verification failed."
sha=$(sha256sum "$before") || fail "Cannot hash backup."
printf '%s\n' "$sha" > "$backup/sha256sum.txt"
info "Backup ready at $backup ($sha)"
candidate="$backup/candidate.db"
cp "$before" "$candidate" || fail "Cannot stage the migration candidate."

# Convert legacy checkpoints and repair settled bank rows inside the
# candidate only. Every postcondition is an assertion row: a violated
# CHECK aborts the script before COMMIT, the CLI exits nonzero, and
# closing the connection rolls the candidate back. The original is
# untouched by any candidate failure.
if [ "$mode" = convert ]; then
  convert_sql="$backup/convert.sql"
  {
    printf '%s\n' ".bail on" "PRAGMA foreign_keys=ON;" "BEGIN IMMEDIATE;"
    printf '%s\n' "CREATE TEMP TABLE assert_ok(ok INTEGER CHECK(ok = 1));"
    cat <<'DDL'
CREATE TABLE checkpoints_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  model_account_id TEXT NOT NULL,
  balance REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, id),
  UNIQUE(user_id, model_account_id, observed_at),
  FOREIGN KEY(user_id, model_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO checkpoints_new(user_id, id, position, model_account_id, balance, source, observed_at)
  SELECT user_id, id, position, model_account_id, balance, source, CAST(strftime('%s', "date" || ' 23:59:59') AS INTEGER)
  FROM checkpoints;
INSERT INTO assert_ok(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM checkpoints) != (SELECT COUNT(*) FROM checkpoints_new) THEN 0 ELSE 1 END;
INSERT INTO assert_ok(ok) SELECT CASE WHEN EXISTS (
  SELECT 1 FROM checkpoints o WHERE NOT EXISTS (
    SELECT 1 FROM checkpoints_new n
    WHERE n.user_id = o.user_id AND n.id = o.id AND n.position = o.position
      AND n.model_account_id = o.model_account_id AND n.balance = o.balance AND n.source = o.source
      AND n.observed_at = CAST(strftime('%s', o."date" || ' 23:59:59') AS INTEGER))
) THEN 0 ELSE 1 END;
INSERT INTO assert_ok(ok) SELECT CASE WHEN EXISTS (
  SELECT 1 FROM checkpoints_new WHERE observed_at IS NULL OR typeof(observed_at) != 'integer' OR observed_at <= 0
) THEN 0 ELSE 1 END;
DROP TABLE checkpoints;
ALTER TABLE checkpoints_new RENAME TO checkpoints;
UPDATE postings SET enabled = 1 WHERE source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND enabled = 0;
UPDATE postings SET transaction_time = posted_time WHERE source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND transaction_time != posted_time;
INSERT INTO assert_ok(ok) SELECT CASE WHEN EXISTS (
  SELECT 1 FROM postings
  WHERE (source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND enabled = 0)
     OR (source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND transaction_time != posted_time)
) THEN 0 ELSE 1 END;
INSERT INTO assert_ok(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_integrity_check WHERE integrity_check != 'ok') THEN 0 ELSE 1 END;
INSERT INTO assert_ok(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_foreign_key_check) != 0 THEN 0 ELSE 1 END;
COMMIT;
DDL
  } > "$convert_sql"
  if ! sqlite3 "$candidate" < "$convert_sql" > "$backup/convert.log" 2>&1; then
    printf 'migrate: conversion failed: %s\n' "$(cat "$backup/convert.log")" >&2
    fail "Candidate conversion failed without committing. Original unchanged; verified backup retained at $backup. Keep the API stopped."
  fi
fi

# Frozen upgrade SQL stays outside application setup. A complete Analysis
# schema stays untouched; partial schemas already failed the source preflight.
if [ "$analysis" = 0 ]; then
  if ! sqlite3 "$candidate" < "$script_dir/analysis-schema.sql" > "$backup/analysis.log" 2>&1; then
    fail "Candidate Analysis upgrade failed. Original unchanged; backup retained at $backup."
  fi
fi

# Verify the full candidate before publication: target schema, integrity,
# foreign keys, and every preserved table against the backup. Only the
# checkpoint date-to-instant conversion and the settled-bank repair may
# differ; Analysis rows for preexisting Analysis must be byte-identical.
check_target "$candidate" || fail "Candidate Analysis verification failed. Original unchanged; backup retained at $backup. Keep the API stopped."
check_integrity "$candidate" || fail "Candidate integrity check failed. Original unchanged; backup retained at $backup. Keep the API stopped."
test "$(cp_cols "$candidate")" = "$FINAL_COLS" &&
  test "$(scoped_pk "$candidate")" = 1 &&
  test "$(exact_unique "$candidate" user_id model_account_id observed_at)" -ge 1 &&
  final_fks_ok "$candidate" &&
  test "$(sqlite3 -readonly "$candidate" "SELECT COUNT(*) FROM checkpoints WHERE typeof(observed_at) != 'integer' OR observed_at <= 0;")" = 0 \
  || fail "Candidate checkpoint schema verification failed. Original unchanged; backup retained at $backup. Keep the API stopped."

verify_same() {
  table=$1
  snapshot=${2:-$before}
  changed=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$snapshot")' AS before;
    SELECT (SELECT count(*) FROM main.\"$table\") != (SELECT count(*) FROM before.\"$table\")
      OR EXISTS(SELECT * FROM main.\"$table\" EXCEPT SELECT * FROM before.\"$table\")
      OR EXISTS(SELECT * FROM before.\"$table\" EXCEPT SELECT * FROM main.\"$table\");") || return 1
  test "$changed" = 0
}

tables=$(sqlite3 -readonly "$before" "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','checkpoints','postings','transaction_source_facts','analysis_inputs','analysis_runs','analysis_findings','analysis_feedback') ORDER BY name;") \
  || fail "Cannot list backup tables; refusing to publish."
for table in $tables; do
  case "$table" in *[!a-z0-9_]*) fail "Unsupported application table name." ;; esac
  verify_same "$table" || fail "Candidate changed preserved table $table. Original unchanged; backup retained at $backup. Keep the API stopped."
done

if [ "$mode" = convert ]; then
  same_count=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before; SELECT (SELECT COUNT(*) FROM main.checkpoints) != (SELECT COUNT(*) FROM before.checkpoints);") \
    || fail "Cannot verify candidate checkpoints; refusing to publish."
  test "$same_count" = 0 || fail "Candidate changed checkpoint row count. Original unchanged; backup retained at $backup. Keep the API stopped."
  mapped=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before; SELECT EXISTS (SELECT 1 FROM before.checkpoints o WHERE NOT EXISTS (SELECT 1 FROM main.checkpoints n WHERE n.user_id = o.user_id AND n.id = o.id AND n.position = o.position AND n.model_account_id = o.model_account_id AND n.balance = o.balance AND n.source = o.source AND n.observed_at = CAST(strftime('%s', o.\"date\" || ' 23:59:59') AS INTEGER)));") \
    || fail "Cannot verify candidate checkpoints; refusing to publish."
  test "$mapped" = 0 || fail "Candidate changed checkpoint values beyond day-close conversion. Original unchanged; backup retained at $backup. Keep the API stopped."
  post_count=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before; SELECT (SELECT COUNT(*) FROM main.postings) != (SELECT COUNT(*) FROM before.postings);") \
    || fail "Cannot verify candidate postings; refusing to publish."
  test "$post_count" = 0 || fail "Candidate changed posting row count. Original unchanged; backup retained at $backup. Keep the API stopped."
  post_same=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before;
    SELECT EXISTS (SELECT * FROM main.postings WHERE source IN ('user', 'model', '') OR pending != 0 OR void != 0 EXCEPT SELECT * FROM before.postings WHERE source IN ('user', 'model', '') OR pending != 0 OR void != 0)
        OR EXISTS (SELECT * FROM before.postings WHERE source IN ('user', 'model', '') OR pending != 0 OR void != 0 EXCEPT SELECT * FROM main.postings WHERE source IN ('user', 'model', '') OR pending != 0 OR void != 0);") \
    || fail "Cannot verify candidate postings; refusing to publish."
  test "$post_same" = 0 || fail "Candidate changed non-settled postings. Original unchanged; backup retained at $backup. Keep the API stopped."
  post_repair=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before; SELECT EXISTS (
    SELECT 1 FROM before.postings o LEFT JOIN main.postings n ON n.user_id = o.user_id AND n.id = o.id
    WHERE o.source NOT IN ('user', 'model', '') AND o.pending = 0 AND o.void = 0
      AND (n.id IS NULL OR n.enabled != 1 OR n.transaction_time != n.posted_time
        OR n.position IS NOT o.position OR n.name IS NOT o.name
        OR n.source_account_id IS NOT o.source_account_id OR n.destinations IS NOT o.destinations
        OR n.amount_resolution_json IS NOT o.amount_resolution_json
        OR n.posted_time IS NOT o.posted_time
        OR n.fulfills_rule_id IS NOT o.fulfills_rule_id
        OR n.fulfills_occurrence_date IS NOT o.fulfills_occurrence_date
        OR n.source IS NOT o.source OR n.pending IS NOT o.pending OR n.void IS NOT o.void
        OR n.execution_order IS NOT o.execution_order OR n.receipt_ids IS NOT o.receipt_ids));") \
    || fail "Cannot verify candidate postings; refusing to publish."
  test "$post_repair" = 0 || fail "Candidate bank repair is incomplete or overreached. Original unchanged; backup retained at $backup. Keep the API stopped."
else
  verify_same checkpoints || fail "Candidate changed final checkpoints. Original unchanged; backup retained at $backup. Keep the API stopped."
  verify_same postings || fail "Candidate changed postings on a final-checkpoint source. Original unchanged; backup retained at $backup. Keep the API stopped."
fi

if [ "$analysis" = 5 ]; then
  for table in transaction_source_facts analysis_inputs analysis_runs analysis_findings analysis_feedback; do
    verify_same "$table" || fail "Candidate changed preexisting Analysis table $table. Original unchanged; backup retained at $backup. Keep the API stopped."
  done
  triggers_same=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before;
    SELECT EXISTS (SELECT sql FROM main.sqlite_master WHERE type = 'trigger' EXCEPT SELECT sql FROM before.sqlite_master WHERE type = 'trigger')
        OR EXISTS (SELECT sql FROM before.sqlite_master WHERE type = 'trigger' EXCEPT SELECT sql FROM main.sqlite_master WHERE type = 'trigger');") \
    || fail "Cannot verify candidate triggers; refusing to publish."
  test "$triggers_same" = 0 || fail "Candidate changed Analysis triggers. Original unchanged; backup retained at $backup. Keep the API stopped."
else
  empty=$(sqlite3 -readonly "$candidate" "SELECT (SELECT COUNT(*) FROM transaction_source_facts) + (SELECT COUNT(*) FROM analysis_inputs) + (SELECT COUNT(*) FROM analysis_runs) + (SELECT COUNT(*) FROM analysis_findings) + (SELECT COUNT(*) FROM analysis_feedback);") \
    || fail "Cannot verify provisioned Analysis tables; refusing to publish."
  test "$empty" = 0 || fail "Provisioned Analysis tables are not empty. Original unchanged; backup retained at $backup. Keep the API stopped."
fi
markers_kept=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before; SELECT EXISTS (SELECT name FROM before.schema_migrations EXCEPT SELECT name FROM main.schema_migrations);") \
  || fail "Cannot verify schema markers; refusing to publish."
test "$markers_kept" = 0 || fail "Candidate dropped schema markers. Original unchanged; backup retained at $backup. Keep the API stopped."

# Verify purchase conversion separately against the already-verified timestamp
# candidate. The original database still has no writes at this point.
if [ "$purchases" = purchase_policies ]; then
  purchase_before="$backup/before-purchases.db"
  sqlite3 "$candidate" ".backup '$(esc "$purchase_before")'"
  if ! upgrade-planned-purchases --db "$candidate" > "$backup/purchases.log" 2>&1; then
    printf 'migrate: purchase conversion failed: %s\n' "$(cat "$backup/purchases.log")" >&2
    fail "Candidate purchase conversion failed. Original unchanged; backup retained at $backup."
  fi
  purchase_tables=$(sqlite3 -readonly "$purchase_before" "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('purchase_policies','postings','entity_ids') ORDER BY name;")
  for table in $purchase_tables; do
    case "$table" in *[!a-z0-9_]*) fail "Unsupported application table name." ;; esac
    verify_same "$table" "$purchase_before" || fail "Purchase conversion changed preserved table $table. Original unchanged; backup retained at $backup."
  done
  purchase_delta=$(sqlite3 -readonly "$candidate" "ATTACH DATABASE '$(esc "$purchase_before")' AS original;
    SELECT (SELECT count(*) FROM main.planned_purchases)!=(SELECT count(*) FROM original.purchase_policies)
      OR EXISTS(SELECT * FROM main.postings EXCEPT SELECT p.* FROM original.postings p WHERE NOT EXISTS(SELECT 1 FROM original.purchase_policies q WHERE q.user_id=p.user_id AND q.posting_id=p.id))
      OR EXISTS(SELECT p.* FROM original.postings p WHERE NOT EXISTS(SELECT 1 FROM original.purchase_policies q WHERE q.user_id=p.user_id AND q.posting_id=p.id) EXCEPT SELECT * FROM main.postings)
      OR EXISTS(SELECT * FROM main.entity_ids WHERE kind!='planned-purchase' EXCEPT SELECT e.* FROM original.entity_ids e WHERE NOT EXISTS(SELECT 1 FROM original.purchase_policies q WHERE q.user_id=e.user_id AND q.posting_id=e.id))
      OR EXISTS(SELECT e.* FROM original.entity_ids e WHERE NOT EXISTS(SELECT 1 FROM original.purchase_policies q WHERE q.user_id=e.user_id AND q.posting_id=e.id) EXCEPT SELECT * FROM main.entity_ids WHERE kind!='planned-purchase')
      OR EXISTS(SELECT 1 FROM original.purchase_policies q JOIN original.postings p ON p.user_id=q.user_id AND p.id=q.posting_id LEFT JOIN main.planned_purchases n ON n.user_id=p.user_id AND n.id=p.id LEFT JOIN main.entity_ids e ON e.user_id=p.user_id AND e.id=p.id
        WHERE n.id IS NULL OR e.kind IS NOT 'planned-purchase' OR n.name IS NOT p.name OR n.position IS NOT p.position OR n.funding_account_id IS NOT p.source_account_id OR n.cost IS NOT CAST(json_extract(p.amount_resolution_json,'$.config.expression') AS REAL) OR n.earliest_date IS NOT date(CASE WHEN p.transaction_time>0 THEN p.transaction_time ELSE p.posted_time END,'unixepoch') OR n.priority IS NOT q.priority OR n.enabled IS NOT p.enabled);")
  test "$purchase_delta" = 0 || fail "Purchase conversion changed unexpected rows. Original unchanged; backup retained at $backup."
fi

# Setup validates the final shape only. A digest of the logical database also
# proves that the validator did not rewrite any candidate rows or schema.
validation_before=$(sqlite3 "$candidate" .dump | sha256sum)
if ! setupdb --db "$candidate" > "$backup/setup.log" 2>&1; then
  printf 'migrate: setupdb failed: %s\n' "$(cat "$backup/setup.log")" >&2
  fail "Candidate setup failed. Original unchanged; verified backup retained at $backup. Keep the API stopped."
fi
validation_after=$(sqlite3 "$candidate" .dump | sha256sum)
test "$validation_before" = "$validation_after" || fail "Candidate setup changed schema or rows. Original unchanged; backup retained at $backup."
check_integrity "$candidate" || fail "Candidate integrity check failed after purchase conversion. Original unchanged; backup retained at $backup."

# Publish the verified candidate over the original with the backup API.
# The destination file keeps its path, permissions, and ownership.
sqlite3 "$candidate" ".backup main '$(esc "$db")'" \
  || fail "Publication failed. Original may need recovery from the verified backup at $backup. Keep the API stopped."
check_target "$db" || fail "Published database failed Analysis verification. Recover from the verified backup at $backup. Keep the API stopped."
check_integrity "$db" || fail "Published database failed integrity check. Recover from the verified backup at $backup. Keep the API stopped."

if [ "$mode" = convert ]; then
  info "Converted legacy checkpoints to UTC day-close instants, repaired settled bank rows, and provisioned Analysis schema from $backup."
else
  info "Completed Analysis schema on final checkpoints from $backup."
fi
