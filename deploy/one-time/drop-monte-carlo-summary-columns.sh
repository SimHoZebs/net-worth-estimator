#!/bin/sh
# One-time operator migration: remove the retired Monte Carlo summary columns
# from monte_carlo_statistics. The live store now round-trips only as_of_at
# and the P10-P90 bands; the dropped values are duplicate computed output.
#
# Run offline with every API writer stopped, against the real durable
# database, from the reviewed target image. The server never invokes this.
# See deploy/MIGRATIONS.md. Requires sqlite3 with ALTER TABLE DROP COLUMN.
set -eu
umask 077

fail() { printf 'drop-monte-carlo-summary-columns: %s\n' "$1" >&2; exit 1; }
info() { printf 'drop-monte-carlo-summary-columns: %s\n' "$1"; }

: "${NET_WORTH_ESTIMATOR_DB:?database path is required}"
db=$NET_WORTH_ESTIMATOR_DB
case "$db" in *"'"*) fail 'database path must not contain single quotes' ;; esac
test -f "$db" || fail "database does not exist: $db"
test ! -e "$db-journal" || fail "database is not quiescent ($db-journal exists)"

table_count=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='monte_carlo_statistics';") \
  || fail 'cannot inspect database'
case "$table_count" in
  0) info 'monte_carlo_statistics absent; nothing to migrate'; exit 0 ;;
  1) ;;
  *) fail 'partial monte_carlo_statistics schema' ;;
esac

present=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('monte_carlo_statistics') WHERE name IN ('sample_count','mean','median','std_dev','probability_below_zero');") \
  || fail 'cannot inspect monte_carlo_statistics columns'
case "$present" in
  0) info 'retired summary columns already absent; nothing to migrate'; exit 0 ;;
  5) ;;
  *) fail 'partial retired summary column group; refusing to guess' ;;
esac
retained=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM pragma_table_info('monte_carlo_statistics') WHERE name IN ('user_id','id','projection_slice_id','account_id','as_of_at','p10','p25','p50','p75','p90');") \
  || fail 'cannot inspect retained columns'
test "$retained" = 10 || fail 'retained Monte Carlo columns are incomplete'

integrity=$(sqlite3 -readonly "$db" 'PRAGMA integrity_check;') || fail 'integrity check failed'
test "$integrity" = ok || fail "integrity check: $integrity"
violations=$(sqlite3 -readonly "$db" 'SELECT COUNT(*) FROM pragma_foreign_key_check;') || fail 'foreign key check failed'
test "$violations" = 0 || fail "$violations foreign key violations"
row_digest() {
  sqlite3 -readonly "$1" "SELECT COUNT(*) || ':' || COALESCE(SUM(LENGTH(id)),0) || ':' || COALESCE(SUM(LENGTH(as_of_at)),0) || ':' || COALESCE(SUM(p10+p25+p50+p75+p90),0) FROM monte_carlo_statistics;"
}
before_digest=$(row_digest "$db") || fail 'cannot digest retained rows'

backup_dir=$(mktemp -d "${db}.mc-summary-backup.XXXXXX") || fail 'cannot create backup directory'
backup="$backup_dir/before.db"
candidate="$backup_dir/candidate.db"
sqlite3 -readonly "$db" ".backup '$backup'" || { rm -rf "$backup_dir"; fail 'backup failed'; }
backup_integrity=$(sqlite3 -readonly "$backup" 'PRAGMA integrity_check;') || { rm -rf "$backup_dir"; fail 'backup integrity check failed'; }
test "$backup_integrity" = ok || { rm -rf "$backup_dir"; fail 'backup integrity check failed'; }
cp "$backup" "$candidate" || { rm -rf "$backup_dir"; fail 'candidate copy failed'; }

for column in sample_count mean median std_dev probability_below_zero; do
  sqlite3 "$candidate" "ALTER TABLE monte_carlo_statistics DROP COLUMN $column;" \
    || { rm -rf "$backup_dir"; fail "could not drop $column"; }
done

after_columns=$(sqlite3 -readonly "$candidate" "SELECT COUNT(*) FROM pragma_table_info('monte_carlo_statistics') WHERE name IN ('sample_count','mean','median','std_dev','probability_below_zero');") \
  || { rm -rf "$backup_dir"; fail 'cannot inspect candidate columns'; }
test "$after_columns" = 0 || { rm -rf "$backup_dir"; fail 'retired columns survived on candidate'; }
after_digest=$(row_digest "$candidate") || { rm -rf "$backup_dir"; fail 'cannot digest candidate rows'; }
test "$after_digest" = "$before_digest" || { rm -rf "$backup_dir"; fail 'retained rows changed on candidate'; }
candidate_integrity=$(sqlite3 -readonly "$candidate" 'PRAGMA integrity_check;') || { rm -rf "$backup_dir"; fail 'candidate integrity check failed'; }
test "$candidate_integrity" = ok || { rm -rf "$backup_dir"; fail 'candidate integrity check failed'; }
candidate_violations=$(sqlite3 -readonly "$candidate" 'SELECT COUNT(*) FROM pragma_foreign_key_check;') || { rm -rf "$backup_dir"; fail 'candidate foreign key check failed'; }
test "$candidate_violations" = 0 || { rm -rf "$backup_dir"; fail 'candidate foreign key violations'; }

sqlite3 "$candidate" ".backup '$db'" || { rm -rf "$backup_dir"; fail 'publication failed'; }
test "$(row_digest "$db")" = "$before_digest" || fail 'published rows do not match the verified candidate'
info "published; pre-migration backup retained at $backup"
