#!/bin/sh
# One-time: normalize legacy bank row sources to the current banksync value.
# Run with every API writer stopped. See README.md.
set -eu
umask 077

db=${1:?usage: run.sh DATABASE}
test -f "$db" || {
	printf 'bank-source: database not found: %s\n' "$db" >&2
	exit 1
}
case "$db" in
*"'"*)
	printf 'bank-source: database path must not contain a single quote\n' >&2
	exit 1
	;;
esac

backup="${db}.before-bank-source-$(date -u +%Y%m%dT%H%M%SZ)"
sqlite3 "$db" ".backup '$backup'"

sqlite3 "$db" "
BEGIN IMMEDIATE;
UPDATE postings SET source = 'banksync' WHERE source = 'simplefin';
UPDATE checkpoints SET source = 'banksync' WHERE source = 'simplefin';
COMMIT;
"

postings=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM postings WHERE source = 'simplefin';")
checkpoints=$(sqlite3 -readonly "$db" "SELECT COUNT(*) FROM checkpoints WHERE source = 'simplefin';")
test "$postings" = "0" || {
	printf 'bank-source: %s postings still carry simplefin; restore %s\n' "$postings" "$backup" >&2
	exit 1
}
test "$checkpoints" = "0" || {
	printf 'bank-source: %s checkpoints still carry simplefin; restore %s\n' "$checkpoints" "$backup" >&2
	exit 1
}

printf 'bank-source: normalized legacy bank sources; backup=%s\n' "$backup"
