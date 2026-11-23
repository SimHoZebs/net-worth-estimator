#!/bin/sh
# One-time operator migration: remove analysis_runs.input_json. The analysis
# snapshot is loaded from live rows at claim time, so the stored JSON copy is
# never read back and its bytes are intentionally discarded.
#
# Run offline with every API writer stopped, against the real durable
# database, from the reviewed target image. The server never invokes this.
# This must run BEFORE deploying the release whose ClaimAnalysis no longer
# supplies input_json: on an unconverted database that INSERT violates the
# column's NOT NULL constraint. See deploy/MIGRATIONS.md.
set -eu
umask 077

fail() { printf 'drop-analysis-run-input-json: %s\n' "$1" >&2; exit 1; }
info() { printf 'drop-analysis-run-input-json: %s\n' "$1"; }

: "${NET_WORTH_ESTIMATOR_DB:?database path is required}"
db=$NET_WORTH_ESTIMATOR_DB
case "$db" in *"'"*) fail 'database path must not contain single quotes' ;; esac
test -f "$db" || fail "database does not exist: $db"
test ! -e "$db-journal" || fail "database is not quiescent ($db-journal exists)"

table_count=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='analysis_runs';") \
  || fail 'cannot inspect database'
case "$table_count" in
  0) info 'analysis_runs absent; nothing to migrate'; exit 0 ;;
  1) ;;
  *) fail 'partial analysis_runs schema' ;;
esac

present=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('analysis_runs') WHERE name='input_json';") \
  || fail 'cannot inspect analysis_runs columns'
case "$present" in
  0) info 'input_json already absent; nothing to migrate'; exit 0 ;;
  1) ;;
  *) fail 'partial input_json column shape; refusing to guess' ;;
esac
retained=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('analysis_runs') WHERE name IN ('user_id','id','type','version','input_revision','state','started_at','completed_at','lease_until','problem');") \
  || fail 'cannot inspect retained columns'
test "$retained" = 10 || fail 'retained analysis run columns are incomplete'

integrity=$(sqlite3 -readonly "$db" 'PRAGMA integrity_check;') || fail 'integrity check failed'
test "$integrity" = ok || fail "integrity check: $integrity"
violations=$(sqlite3 -readonly "$db" 'SELECT COUNT(*) FROM pragma_foreign_key_check;') || fail 'foreign key check failed'
test "$violations" = 0 || fail "$violations foreign key violations"
row_digest() {
  sqlite3 -readonly "$1" "SELECT COUNT(*) || ':' || COALESCE(SUM(LENGTH(id)+LENGTH(type)+LENGTH(version)+LENGTH(state)+LENGTH(problem)),0) || ':' || COALESCE(SUM(input_revision+started_at+completed_at+lease_until),0) FROM analysis_runs;"
}
before_digest=$(row_digest "$db") || fail 'cannot digest retained rows'

backup_dir=$(mktemp -d "${db}.analysis-input-json-backup.XXXXXX") || fail 'cannot create backup directory'
backup="$backup_dir/before.db"
candidate="$backup_dir/candidate.db"
sqlite3 -readonly "$db" ".backup '$backup'" || { rm -rf "$backup_dir"; fail 'backup failed'; }
backup_integrity=$(sqlite3 -readonly "$backup" 'PRAGMA integrity_check;') || { rm -rf "$backup_dir"; fail 'backup integrity check failed'; }
test "$backup_integrity" = ok || { rm -rf "$backup_dir"; fail 'backup integrity check failed'; }
cp "$backup" "$candidate" || { rm -rf "$backup_dir"; fail 'candidate copy failed'; }

sqlite3 "$candidate" 'ALTER TABLE analysis_runs DROP COLUMN input_json;' \
  || { rm -rf "$backup_dir"; fail 'could not drop input_json'; }

after_column=$(sqlite3 -readonly "$candidate" "SELECT COUNT(*) FROM pragma_table_info('analysis_runs') WHERE name='input_json';") \
  || { rm -rf "$backup_dir"; fail 'cannot inspect candidate columns'; }
test "$after_column" = 0 || { rm -rf "$backup_dir"; fail 'input_json survived on candidate'; }
after_digest=$(row_digest "$candidate") || { rm -rf "$backup_dir"; fail 'cannot digest candidate rows'; }
test "$after_digest" = "$before_digest" || { rm -rf "$backup_dir"; fail 'retained rows changed on candidate'; }
candidate_integrity=$(sqlite3 -readonly "$candidate" 'PRAGMA integrity_check;') || { rm -rf "$backup_dir"; fail 'candidate integrity check failed'; }
test "$candidate_integrity" = ok || { rm -rf "$backup_dir"; fail 'candidate integrity check failed'; }
candidate_violations=$(sqlite3 -readonly "$candidate" 'SELECT COUNT(*) FROM pragma_foreign_key_check;') || { rm -rf "$backup_dir"; fail 'candidate foreign key check failed'; }
test "$candidate_violations" = 0 || { rm -rf "$backup_dir"; fail 'candidate foreign key violations'; }

sqlite3 "$candidate" ".backup '$db'" || { rm -rf "$backup_dir"; fail 'publication failed'; }
test "$(row_digest "$db")" = "$before_digest" || fail 'published rows do not match the verified candidate'
info "published; pre-migration backup retained at $backup"
