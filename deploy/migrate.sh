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
#   4. The additive unified projection tables and columns are provisioned
#      when absent; a partial group fails closed.
#   5. The completed posting-ID migration audit table is removed.
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
# with zero or all six Analysis tables. Partial Analysis schemas, unknown
# checkpoint shapes (including a date+observed_at mix, which was never
# deployed), pre-user-scope tables, malformed or NULL or normalized-invalid
# dates, and missing or non-integer or non-positive posted instants all fail
# closed before any backup or mutation. A complete target (final checkpoints
# plus the full Analysis schema) repeats read-only checks only and never
# reactivates a post-upgrade owner disable. An absent database file fails:
# provisioning fresh storage is `setupdb` and `api-boot.sh`, not
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
  SELECT user_id, id, name, source_account_id, amount_resolution_json, posted_time, transaction_time, source, pending, void FROM postings LIMIT 0;
  SELECT user_id, provider, bridge_account_id, transaction_id, posting_id FROM posting_sync_keys LIMIT 0;
  SELECT user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled FROM recurrence_rules LIMIT 0;
  SELECT user_id, type, instance_id, position, name, enabled, config_json FROM evaluations LIMIT 0;
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
  test "$(sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name IN ('analysis_facts_insert','analysis_facts_update','analysis_facts_delete','analysis_posting_lifecycle','analysis_posting_sim_lifecycle');")" -ge 4 || return 1
  test "$(sqlite3 -readonly "$1" "SELECT count(*) FROM schema_migrations WHERE name IN ('transaction-analysis-v1','analysis-feedback-v1');")" = 2
}

# Promotions link one confirmed pattern to its generated forecast rule.
# Sources that predate the link table carry the other five Analysis tables;
# the candidate provisions this one for them below.
check_promotions() {
  sqlite3 -readonly "$1" '
    SELECT user_id, pattern_key, rule_id, created_at FROM analysis_promotions LIMIT 0;' || return 1
}

analysis_count() {
  sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('transaction_source_facts','analysis_inputs','analysis_runs','analysis_findings','analysis_feedback','analysis_promotions');"
}

# Sharing tracks provision-if-missing like friendships: absent is expected
# on pre-sharing databases, present requires the exact current shape, and
# anything partial fails closed. Mail credential and receipt-discovery
# tables stay out: they self-heal at first use, so this body never touches
# those working paths.
check_sharing() {
  sqlite3 -readonly "$1" '
    SELECT owner_user_id, posting_id, audience_type, audience_id, intent, created_at FROM sharing_grants LIMIT 0;
    SELECT recipient_user_id, copy_posting_id, source_owner_id, source_posting_id, link_id, source_revision, grant_audience_type, grant_audience_id, grant_reason, copied_at, refreshed_at FROM sharing_copies LIMIT 0;
    SELECT recipient_user_id, owner_user_id, posting_id, status, unread, dismissed, received_at, decided_at, copy_posting_id FROM inbox_share_state LIMIT 0;
    SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies LIMIT 0;
    SELECT owner_user_id, posting_id, group_id, policy_version, updated_at FROM sharing_visibility LIMIT 0;
    SELECT id, owner_user_id, actor_user_id, kind, posting_id, audience_type, audience_id, group_id, detail_json, created_at FROM sharing_audit LIMIT 0;
    SELECT actor_user_id, request_id, action, owner_user_id, posting_id, audience_type, audience_id, link_id, outcome_json, created_at FROM sharing_requests LIMIT 0;
    SELECT split_id, version, source_owner_id, source_posting_id, source_revision, initiator_id, currency, total_minor, status, created_at, updated_at FROM splits LIMIT 0;
    SELECT split_id, version, position, participant_id, amount_minor, accepted, accepted_at FROM split_allocations LIMIT 0;
    SELECT settlement_id, split_id, participant_id, amount_minor, linked_owner_id, linked_posting_id, actor_id, request_id, created_at FROM split_settlements LIMIT 0;
    SELECT actor_id, request_id, settlement_id, input_hash, created_at FROM split_settlement_requests LIMIT 0;' || return 1
}

sharing_count() {
  sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('sharing_grants','sharing_copies','inbox_share_state','sharing_policies','sharing_visibility','sharing_audit','sharing_requests','splits','split_allocations','split_settlements','split_settlement_requests');"
}

# Unified projection is one additive schema group: twelve tables plus the
# checkpoint provider and four posting columns. Absent means provision on the
# candidate; complete means verify; any mixture fails closed before a backup.
check_projection() {
  sqlite3 -readonly "$1" '
    SELECT user_id, id, provider_key, status, sync_cursor, last_synced_at FROM provider_connections LIMIT 0;
    SELECT user_id, id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed, det_evaluations_json, stoch_evaluations_json FROM projection_states LIMIT 0;
    SELECT user_id, id, projection_state_id, from_at, to_at, built_revision, status FROM projection_slices LIMIT 0;
    SELECT user_id, projection_slice_id, date, payload FROM projection_rows LIMIT 0;
    SELECT user_id, id, projection_slice_id, account_id, as_of_at, sample_count, mean, median, p10, p25, p50, p75, p90, std_dev, probability_below_zero FROM monte_carlo_statistics LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM net_worth_threshold_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM account_balance_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, requested_amount, realized_amount, destination_limited_amount, unfulfilled_amount, completion_rate, first_underfulfilled_date, events_json, dates_json, postings_json, prob_run_count, prob_fulfilled_count, prob_full_probability, prob_unfulfilled_p10, prob_unfulfilled_p25, prob_unfulfilled_p50, prob_unfulfilled_p75, prob_unfulfilled_p90 FROM posting_fulfillment_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, account_ids_json, statement_day, budget, cycle_start, cycle_end, window_start, days_total, days_left, recorded_spend, scheduled_spend, spent, remaining, within_budget, shortfall, prob_run_count, prob_within_count, prob_within_probability, prob_spent_p10, prob_spent_p25, prob_spent_p50, prob_spent_p75, prob_spent_p90 FROM cycle_fulfillment_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, all_funded, first_reached_date, purchases_json, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM planned_purchases_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, first_coverage_date, first_self_sustaining_date, detail_json, prob_success, prob_median_date, prob_self_sustaining_date, prob_self_sustaining_prob FROM financial_independence_outputs LIMIT 0;
    SELECT user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, final_net_worth, transaction_count, first_unfulfilled_date, all_funded, prob_full_probability, prob_sample_count FROM whatif_outputs LIMIT 0;' || return 1
  test "$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_table_info('checkpoints') WHERE name='provider';")" = 1 || return 1
  test "$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_table_info('postings') WHERE name IN ('projection_slice_id','event_json','applied_amount','outcome');")" = 4
}

projection_count() {
  sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('provider_connections','projection_states','projection_slices','projection_rows','monte_carlo_statistics','net_worth_threshold_outputs','account_balance_outputs','posting_fulfillment_outputs','cycle_fulfillment_outputs','planned_purchases_outputs','financial_independence_outputs','whatif_outputs');"
}

projection_state() {
  tables=$(projection_count "$1") || fail "Cannot inspect unified projection tables; refusing to guess."
  provider=$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_table_info('checkpoints') WHERE name='provider';") \
    || fail "Cannot inspect checkpoint provider column; refusing to guess."
  posting_cols=$(sqlite3 -readonly "$1" "SELECT COUNT(*) FROM pragma_table_info('postings') WHERE name IN ('projection_slice_id','event_json','applied_amount','outcome');") \
    || fail "Cannot inspect posting projection columns; refusing to guess."
  case "$tables:$provider:$posting_cols" in
    0:0:0) echo 0 ;;
    12:1:4)
      check_projection "$1" || fail "Incomplete unified projection schema. Refusing automatic repair."
      echo 1 ;;
    *) fail "Partial unified projection schema. Refusing automatic repair." ;;
  esac
}

# Friendships are provision-if-missing like the Analysis schema: absent is
# expected on pre-friend databases, present requires the exact accepted-edge
# shape, and anything partial fails closed.
friendships_state() {
  count=$(sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='friendships';") \
    || fail "Cannot inspect friendships schema; refusing to guess."
  case "$count" in
    0) echo 0; return 0 ;;
    1) ;;
    *) fail "Partial friendships schema. Refusing automatic repair." ;;
  esac
  sqlite3 -readonly "$1" 'SELECT user_id, friend_user_id, display_name, created_at FROM friendships LIMIT 0;' \
    || fail "Incomplete friendships schema. Refusing automatic repair."
  echo 1
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
PRE_PROVIDER_COLS="user_id,id,position,model_account_id,balance,source,observed_at"
FINAL_COLS="user_id,id,position,model_account_id,balance,source,provider,observed_at"
FINAL_APPENDED_COLS="user_id,id,position,model_account_id,balance,source,observed_at,provider"

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
postings_destination=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('postings') WHERE name IN ('destinations','destination_account_ids');") \
  || fail "Cannot inspect postings columns; refusing to guess."
test "$postings_destination" -ge 1 || fail "Postings lack a destination column; refusing automatic repair."
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
  0|5|6) ;;
  *) fail "Partial Analysis schema. Refusing automatic repair." ;;
esac
friendships=$(friendships_state "$db") || fail "Cannot inspect friendships schema; refusing to guess."
if [ "$analysis" = 5 ] || [ "$analysis" = 6 ]; then
  check_target "$db" || fail "Incomplete Analysis schema. Refusing automatic repair."
fi
if [ "$analysis" = 6 ]; then
  check_promotions "$db" || fail "Incomplete promotion schema. Refusing automatic repair."
fi
sharing=$(sharing_count "$db") || fail "Cannot inspect sharing schema; refusing to guess."
case "$sharing" in
  0|11) ;;
  *) fail "Partial sharing schema. Refusing automatic repair." ;;
esac
if [ "$sharing" = 11 ]; then
  check_sharing "$db" || fail "Incomplete sharing schema. Refusing automatic repair."
fi
projection=$(projection_state "$db") || fail "Cannot inspect unified projection schema; refusing to guess."
posting_audit=$(sqlite3 -readonly "$db" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='posting_id_migrations';") \
  || fail "Cannot inspect posting-ID audit table."
postings_split=0
if [ "$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'posting_sim';")" = 1 ] && \
   [ "$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('postings') WHERE name = 'destination_account_ids';")" = 1 ]; then
  postings_split=1
fi
mode=""
if [ "$cols" = "$LEGACY_COLS" ]; then
  mode="convert"
elif [ "$cols" = "$PRE_PROVIDER_COLS" ] || [ "$cols" = "$FINAL_COLS" ] || [ "$cols" = "$FINAL_APPENDED_COLS" ]; then
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
if [ "$mode" = verify ] && [ "$analysis" = 6 ] && [ "$purchases" = planned_purchases ] && [ "$posting_audit" = 0 ] && [ "$postings_split" = 1 ] && [ "$friendships" = 1 ] && [ "$sharing" = 11 ] && [ "$projection" = 1 ]; then  info "Checkpoints already carry observation instants with complete application schema; verified, nothing to do."
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

# Split pre-split postings into fact plus sim/claim satellites before any
# checkpoint, Analysis, or purchase work. The tool is idempotent on an
# already-split target.
if ! upgrade-posting-sim-split --db "$candidate" > "$backup/posting-sim.log" 2>&1; then
  printf 'migrate: posting split failed: %s\n' "$(cat "$backup/posting-sim.log")" >&2
  fail "Candidate posting split failed. Original unchanged; backup retained at $backup. Keep the API stopped."
fi
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
DROP TRIGGER IF EXISTS analysis_posting_sim_lifecycle;
UPDATE posting_sim SET enabled = 1
WHERE EXISTS (SELECT 1 FROM postings p WHERE p.user_id = posting_sim.user_id AND p.id = posting_sim.posting_id AND p.source NOT IN ('user', 'model', '') AND p.pending = 0 AND p.void = 0 AND posting_sim.enabled = 0);
UPDATE postings SET transaction_time = posted_time WHERE source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND transaction_time != posted_time;
CREATE TRIGGER analysis_posting_sim_lifecycle AFTER UPDATE OF enabled ON posting_sim
		WHEN (OLD.enabled != NEW.enabled)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND posting_id = NEW.posting_id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END;
INSERT INTO assert_ok(ok) SELECT CASE WHEN EXISTS (
  SELECT 1 FROM posting_sim s JOIN postings p ON p.user_id = s.user_id AND p.id = s.posting_id
  WHERE p.source NOT IN ('user', 'model', '') AND p.pending = 0 AND p.void = 0 AND s.enabled = 0
) OR EXISTS (
  SELECT 1 FROM postings
  WHERE source NOT IN ('user', 'model', '') AND pending = 0 AND void = 0 AND transaction_time != posted_time
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
# A source that predates promotion links keeps its five tables verified
# above and gains only the empty link table here.
if [ "$analysis" = 0 ]; then
  if ! sqlite3 "$candidate" < "$script_dir/analysis-schema.sql" > "$backup/analysis.log" 2>&1; then
    fail "Candidate Analysis upgrade failed. Original unchanged; backup retained at $backup."
  fi
fi
if [ "$analysis" = 5 ]; then
  if ! sqlite3 "$candidate" "CREATE TABLE analysis_promotions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern_key TEXT NOT NULL, rule_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, pattern_key)
  );" > "$backup/analysis.log" 2>&1; then
    fail "Candidate promotion upgrade failed. Original unchanged; backup retained at $backup."
  fi
fi

# Provision the accepted-friendships table on pre-friend candidates. The
# DDL mirrors the application schema exactly; rows are never touched, so
# preexisting friendships verify byte-identical below.
if [ "$friendships" = 0 ]; then
  friendships_sql="$backup/friendships.sql"
  cat > "$friendships_sql" <<'DDL'
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS friendships_account ON friendships(friend_user_id, user_id);
DDL
  if ! sqlite3 "$candidate" < "$friendships_sql" > "$backup/friendships.log" 2>&1; then
    fail "Candidate friendships upgrade failed. Original unchanged; backup retained at $backup."
  fi
fi

# Provision the sharing tracks on pre-sharing candidates. The DDL mirrors
# the application schema exactly; rows are never touched, so preexisting
# sharing rows verify byte-identical below.
if [ "$sharing" = 0 ]; then
  sharing_sql="$backup/sharing.sql"
  cat > "$sharing_sql" <<'DDL'
CREATE TABLE IF NOT EXISTS sharing_grants (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posting_id TEXT NOT NULL,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('user', 'group', 'all')),
  audience_id TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL CHECK (intent IN ('shared', 'excluded')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, posting_id, audience_type, audience_id),
  CHECK ((audience_type = 'all' AND audience_id = '' AND intent = 'excluded') OR (audience_type IN ('user', 'group') AND audience_id <> ''))
);
CREATE INDEX IF NOT EXISTS sharing_grants_grantee ON sharing_grants(audience_type, audience_id, intent);
CREATE TABLE IF NOT EXISTS sharing_copies (
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  copy_posting_id TEXT NOT NULL,
  source_owner_id TEXT NOT NULL,
  source_posting_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  source_revision TEXT NOT NULL DEFAULT '',
  grant_audience_type TEXT NOT NULL DEFAULT '',
  grant_audience_id TEXT NOT NULL DEFAULT '',
  grant_reason TEXT NOT NULL DEFAULT '',
  copied_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recipient_user_id, copy_posting_id),
  UNIQUE (link_id)
);
CREATE INDEX IF NOT EXISTS sharing_copies_source ON sharing_copies(source_owner_id, source_posting_id);
CREATE TABLE IF NOT EXISTS inbox_share_state (
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  posting_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  unread INTEGER NOT NULL DEFAULT 1 CHECK (unread IN (0, 1)),
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
  received_at INTEGER NOT NULL,
  decided_at INTEGER NOT NULL DEFAULT 0,
  copy_posting_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (recipient_user_id, owner_user_id, posting_id)
);
CREATE INDEX IF NOT EXISTS inbox_share_state_recipient ON inbox_share_state(recipient_user_id, unread, dismissed);
CREATE TABLE IF NOT EXISTS sharing_policies (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  account_ids_json TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, group_id)
);
CREATE INDEX IF NOT EXISTS sharing_policies_group ON sharing_policies(group_id, enabled);
CREATE TABLE IF NOT EXISTS sharing_visibility (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posting_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, posting_id, group_id)
);
CREATE INDEX IF NOT EXISTS sharing_visibility_group ON sharing_visibility(group_id, owner_user_id, posting_id);
CREATE TABLE IF NOT EXISTS sharing_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('policy-set', 'policy-strip', 'policies-cleared', 'grant', 'revoke', 'exclude', 'unexclude', 'index-rebuild', 'copy-accepted', 'link-refreshed', 'split-created', 'split-updated', 'split-accepted')),
  posting_id TEXT NOT NULL DEFAULT '',
  audience_type TEXT NOT NULL DEFAULT '',
  audience_id TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sharing_audit_owner ON sharing_audit(owner_user_id, created_at);
CREATE TABLE IF NOT EXISTS sharing_requests (
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  posting_id TEXT NOT NULL,
  audience_type TEXT NOT NULL DEFAULT '',
  audience_id TEXT NOT NULL DEFAULT '',
  link_id TEXT NOT NULL DEFAULT '',
  outcome_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_user_id, request_id)
);
CREATE TABLE IF NOT EXISTS splits (
  split_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  source_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_posting_id TEXT NOT NULL,
  source_revision TEXT NOT NULL DEFAULT '',
  initiator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (split_id, version)
);
CREATE INDEX IF NOT EXISTS splits_source ON splits(source_owner_id, source_posting_id);
CREATE TABLE IF NOT EXISTS split_allocations (
  split_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  accepted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (split_id, version, participant_id),
  FOREIGN KEY (split_id, version) REFERENCES splits(split_id, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS split_allocations_participant ON split_allocations(participant_id);
CREATE TABLE IF NOT EXISTS split_settlements (
  settlement_id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  linked_owner_id TEXT REFERENCES users(id),
  linked_posting_id TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((linked_owner_id IS NULL) = (linked_posting_id IS NULL))
);
CREATE INDEX IF NOT EXISTS split_settlements_split ON split_settlements(split_id, created_at, settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS split_settlements_link ON split_settlements(linked_owner_id, linked_posting_id);
CREATE TABLE IF NOT EXISTS split_settlement_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL REFERENCES split_settlements(settlement_id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_id, request_id)
);
DDL
  if ! sqlite3 "$candidate" < "$sharing_sql" > "$backup/sharing.log" 2>&1; then
    fail "Candidate sharing upgrade failed. Original unchanged; backup retained at $backup."
  fi
fi

# Verify the full candidate before publication: target schema, integrity,
# foreign keys, and every preserved table against the backup. Only the
# checkpoint date-to-instant conversion and the settled-bank repair may
# differ; Analysis rows for preexisting Analysis must be byte-identical.
check_target "$candidate" || fail "Candidate Analysis verification failed. Original unchanged; backup retained at $backup. Keep the API stopped."
check_promotions "$candidate" || fail "Candidate promotion verification failed. Original unchanged; backup retained at $backup. Keep the API stopped."
check_sharing "$candidate" || fail "Candidate sharing verification failed. Original unchanged; backup retained at $backup. Keep the API stopped."
check_integrity "$candidate" || fail "Candidate integrity check failed. Original unchanged; backup retained at $backup. Keep the API stopped."
candidate_cols=$(cp_cols "$candidate")
{ [ "$candidate_cols" = "$PRE_PROVIDER_COLS" ] || [ "$candidate_cols" = "$FINAL_COLS" ] || [ "$candidate_cols" = "$FINAL_APPENDED_COLS" ]; } &&
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

tables=$(sqlite3 -readonly "$before" "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','checkpoints','postings','posting_sim','posting_claims','transaction_source_facts','analysis_inputs','analysis_runs','analysis_findings','analysis_feedback','analysis_promotions') ORDER BY name;") \
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
    LEFT JOIN main.posting_sim s ON s.user_id = o.user_id AND s.posting_id = o.id
    WHERE o.source NOT IN ('user', 'model', '') AND o.pending = 0 AND o.void = 0
      AND (n.id IS NULL OR n.transaction_time != n.posted_time
        OR n.name IS NOT o.name
        OR n.source_account_id IS NOT o.source_account_id
        OR n.amount_resolution_json IS NOT o.amount_resolution_json
        OR n.posted_time IS NOT o.posted_time
        OR n.source IS NOT o.source OR n.pending IS NOT o.pending OR n.void IS NOT o.void
        OR s.posting_id IS NULL OR s.enabled != 1));") \
    || fail "Cannot verify candidate postings; refusing to publish."
  test "$post_repair" = 0 || fail "Candidate bank repair is incomplete or overreached. Original unchanged; backup retained at $backup. Keep the API stopped."
else
  verify_same checkpoints || fail "Candidate changed final checkpoints. Original unchanged; backup retained at $backup. Keep the API stopped."
fi

if [ "$analysis" = 5 ] || [ "$analysis" = 6 ]; then
  for table in transaction_source_facts analysis_inputs analysis_runs analysis_findings analysis_feedback; do
    verify_same "$table" || fail "Candidate changed preexisting Analysis table $table. Original unchanged; backup retained at $backup. Keep the API stopped."
  done
  if [ "$analysis" = 6 ]; then
    verify_same analysis_promotions || fail "Candidate changed preexisting Analysis table analysis_promotions. Original unchanged; backup retained at $backup. Keep the API stopped."
  fi
  triggers_same=$(sqlite3 "$candidate" "ATTACH DATABASE '$(esc "$before")' AS before;
    SELECT EXISTS (SELECT sql FROM main.sqlite_master WHERE type = 'trigger' AND name != 'analysis_posting_sim_lifecycle' EXCEPT SELECT sql FROM before.sqlite_master WHERE type = 'trigger' AND name != 'analysis_posting_sim_lifecycle')
        OR EXISTS (SELECT sql FROM before.sqlite_master WHERE type = 'trigger' EXCEPT SELECT sql FROM main.sqlite_master WHERE type = 'trigger');") \
    || fail "Cannot verify candidate triggers; refusing to publish."
  test "$triggers_same" = 0 || fail "Candidate changed Analysis triggers. Original unchanged; backup retained at $backup. Keep the API stopped."
else
  empty=$(sqlite3 -readonly "$candidate" "SELECT (SELECT COUNT(*) FROM transaction_source_facts) + (SELECT COUNT(*) FROM analysis_inputs) + (SELECT COUNT(*) FROM analysis_runs) + (SELECT COUNT(*) FROM analysis_findings) + (SELECT COUNT(*) FROM analysis_feedback) + (SELECT COUNT(*) FROM analysis_promotions);") \
    || fail "Cannot verify provisioned Analysis tables; refusing to publish."
  test "$empty" = 0 || fail "Provisioned Analysis tables are not empty. Original unchanged; backup retained at $backup. Keep the API stopped."
fi
if [ "$sharing" = 0 ]; then
  empty_sharing=$(sqlite3 -readonly "$candidate" "SELECT (SELECT COUNT(*) FROM sharing_grants) + (SELECT COUNT(*) FROM sharing_copies) + (SELECT COUNT(*) FROM inbox_share_state) + (SELECT COUNT(*) FROM sharing_policies) + (SELECT COUNT(*) FROM sharing_visibility) + (SELECT COUNT(*) FROM sharing_audit) + (SELECT COUNT(*) FROM sharing_requests) + (SELECT COUNT(*) FROM splits) + (SELECT COUNT(*) FROM split_allocations) + (SELECT COUNT(*) FROM split_settlements) + (SELECT COUNT(*) FROM split_settlement_requests);") \
    || fail "Cannot verify provisioned sharing tables; refusing to publish."
  test "$empty_sharing" = 0 || fail "Provisioned sharing tables are not empty. Original unchanged; backup retained at $backup. Keep the API stopped."
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
  purchase_tables=$(sqlite3 -readonly "$purchase_before" "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('purchase_policies','postings','posting_sim','posting_claims','entity_ids') ORDER BY name;") \
    || fail "Cannot list backup tables; refusing to publish."
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
      OR EXISTS(SELECT 1 FROM original.purchase_policies q JOIN original.postings p ON p.user_id=q.user_id AND p.id=q.posting_id JOIN original.posting_sim s ON s.user_id=p.user_id AND s.posting_id=p.id LEFT JOIN main.planned_purchases n ON n.user_id=p.user_id AND n.id=p.id LEFT JOIN main.entity_ids e ON e.user_id=p.user_id AND e.id=p.id
        WHERE n.id IS NULL OR e.kind IS NOT 'planned-purchase' OR n.name IS NOT p.name OR n.position IS NOT s.position OR n.funding_account_id IS NOT p.source_account_id OR n.cost IS NOT CAST(json_extract(p.amount_resolution_json,'$.config.expression') AS REAL) OR n.earliest_date IS NOT date(CASE WHEN p.transaction_time>0 THEN p.transaction_time ELSE p.posted_time END,'unixepoch') OR n.priority IS NOT q.priority OR n.enabled IS NOT s.enabled);")
  test "$purchase_delta" = 0 || fail "Purchase conversion changed unexpected rows. Original unchanged; backup retained at $backup."
fi

# Retire completed upgrade bookkeeping only in the verified offline candidate.
if [ "$posting_audit" = 1 ]; then
  sqlite3 "$candidate" 'DROP TABLE posting_id_migrations;' \
    || fail "Cannot remove posting-ID audit table. Original unchanged; backup retained at $backup."
fi

# Provision the unified projection schema additively. Every statement matches
# the current application DDL exactly. No preexisting table or row is touched.
if [ "$projection" = 0 ]; then
  projection_sql="$backup/projection.sql"
  cat > "$projection_sql" <<'DDL'
CREATE TABLE IF NOT EXISTS provider_connections (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			provider_key TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT '',
			sync_cursor TEXT NOT NULL DEFAULT '',
			last_synced_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		);
CREATE TABLE IF NOT EXISTS projection_states (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			scope_id TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 0,
			published_revision INTEGER NOT NULL DEFAULT 0,
			dirty_from INTEGER NOT NULL DEFAULT 0,
			projection_start TEXT NOT NULL DEFAULT '',
			horizon_end TEXT NOT NULL DEFAULT '',
			calendar_timezone TEXT NOT NULL DEFAULT 'UTC',
			engine_version TEXT NOT NULL DEFAULT 'v1',
			trial_count INTEGER NOT NULL DEFAULT 1000,
			stochastic_seed INTEGER,
			det_evaluations_json TEXT NOT NULL DEFAULT '',
			stoch_evaluations_json TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		);
CREATE TABLE IF NOT EXISTS projection_slices (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			projection_state_id TEXT NOT NULL,
			from_at INTEGER NOT NULL,
			to_at INTEGER NOT NULL,
			built_revision INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		);
CREATE INDEX IF NOT EXISTS projection_slices_state ON projection_slices(user_id, projection_state_id, from_at);
CREATE TABLE IF NOT EXISTS projection_rows (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_slice_id TEXT NOT NULL,
			date TEXT NOT NULL,
			payload TEXT NOT NULL,
			PRIMARY KEY(user_id, projection_slice_id, date)
		);
CREATE TABLE IF NOT EXISTS monte_carlo_statistics (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			projection_slice_id TEXT NOT NULL,
			account_id TEXT NOT NULL,
			as_of_at TEXT NOT NULL,
			sample_count INTEGER NOT NULL DEFAULT 0,
			mean REAL NOT NULL DEFAULT 0,
			median REAL NOT NULL DEFAULT 0,
			p10 REAL NOT NULL DEFAULT 0,
			p25 REAL NOT NULL DEFAULT 0,
			p50 REAL NOT NULL DEFAULT 0,
			p75 REAL NOT NULL DEFAULT 0,
			p90 REAL NOT NULL DEFAULT 0,
			std_dev REAL NOT NULL DEFAULT 0,
			probability_below_zero REAL NOT NULL DEFAULT 0,
			PRIMARY KEY(user_id, id)
		);
CREATE INDEX IF NOT EXISTS monte_carlo_statistics_slice ON monte_carlo_statistics(user_id, projection_slice_id, account_id, as_of_at);
CREATE TABLE IF NOT EXISTS net_worth_threshold_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			reached INTEGER,
			first_reached_date TEXT,
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS account_balance_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			reached INTEGER,
			first_reached_date TEXT,
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS posting_fulfillment_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			requested_amount REAL,
			realized_amount REAL,
			destination_limited_amount REAL,
			unfulfilled_amount REAL,
			completion_rate REAL,
			first_underfulfilled_date TEXT,
			events_json TEXT NOT NULL DEFAULT '[]',
			dates_json TEXT NOT NULL DEFAULT '[]',
			postings_json TEXT NOT NULL DEFAULT '[]',
			prob_run_count INTEGER,
			prob_fulfilled_count INTEGER,
			prob_full_probability REAL,
			prob_unfulfilled_p10 REAL,
			prob_unfulfilled_p25 REAL,
			prob_unfulfilled_p50 REAL,
			prob_unfulfilled_p75 REAL,
			prob_unfulfilled_p90 REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS cycle_fulfillment_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			account_ids_json TEXT NOT NULL DEFAULT '[]',
			statement_day INTEGER,
			budget REAL,
			cycle_start TEXT,
			cycle_end TEXT,
			window_start TEXT,
			days_total INTEGER,
			days_left INTEGER,
			recorded_spend REAL,
			scheduled_spend REAL,
			spent REAL,
			remaining REAL,
			within_budget INTEGER,
			shortfall REAL,
			prob_run_count INTEGER,
			prob_within_count INTEGER,
			prob_within_probability REAL,
			prob_spent_p10 REAL,
			prob_spent_p25 REAL,
			prob_spent_p50 REAL,
			prob_spent_p75 REAL,
			prob_spent_p90 REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS planned_purchases_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			all_funded INTEGER,
			first_reached_date TEXT,
			purchases_json TEXT NOT NULL DEFAULT '[]',
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS financial_independence_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			first_coverage_date TEXT,
			first_self_sustaining_date TEXT,
			detail_json TEXT NOT NULL DEFAULT '{}',
			prob_success REAL,
			prob_median_date TEXT,
			prob_self_sustaining_date TEXT,
			prob_self_sustaining_prob REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
CREATE TABLE IF NOT EXISTS whatif_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			final_net_worth REAL,
			transaction_count INTEGER,
			first_unfulfilled_date TEXT,
			all_funded INTEGER,
			prob_full_probability REAL,
			prob_sample_count INTEGER,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		);
ALTER TABLE checkpoints ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE postings ADD COLUMN projection_slice_id TEXT;
ALTER TABLE postings ADD COLUMN event_json TEXT;
ALTER TABLE postings ADD COLUMN applied_amount REAL;
ALTER TABLE postings ADD COLUMN outcome TEXT;
CREATE INDEX IF NOT EXISTS postings_projection_slice ON postings(user_id, projection_slice_id);
DDL
  if ! sqlite3 "$candidate" < "$projection_sql" > "$backup/projection.log" 2>&1; then
    printf 'migrate: projection upgrade failed: %s\n' "$(cat "$backup/projection.log")" >&2
    fail "Candidate unified projection upgrade failed. Original unchanged; backup retained at $backup. Keep the API stopped."
  fi
  check_projection "$candidate" || fail "Candidate unified projection schema is incomplete. Original unchanged; backup retained at $backup. Keep the API stopped."
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
check_projection "$db" || fail "Published database failed unified projection verification. Recover from the verified backup at $backup. Keep the API stopped."
check_integrity "$db" || fail "Published database failed integrity check. Recover from the verified backup at $backup. Keep the API stopped."

if [ "$mode" = convert ]; then
  info "Converted legacy checkpoints to UTC day-close instants, repaired settled bank rows, and provisioned Analysis and unified projection schema from $backup."
else
  info "Completed current application and unified projection schema on final checkpoints from $backup."
fi
