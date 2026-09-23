#!/usr/bin/env bash
# Canned backend smoke: healthz -> financial-model summaries -> POST sync/simplefin.
# Usage: [BASE_URL=http://localhost:8787] smoke-backend.sh [--help]
# Fails on any non-200. NOTE: POST /v1/sync/simplefin returns 503 when the
# backend has no SimpleFIN sync configured, so a fully green run needs one.
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	echo "Usage: [BASE_URL=http://localhost:8787] smoke-backend.sh"
	echo "Canned smoke against a running backend; fails on any non-200."
	exit 0
fi

base="${BASE_URL:-http://localhost:8787}"
for cmd in curl jq; do
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "error: '$cmd' not found on PATH." >&2
		exit 127
	fi
done

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# request <METHOD> <path> : curls into $tmp, prints body on non-200, fails.
request() {
	local method="$1" path="$2" code
	code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$base$path")"
	if [ "$code" != "200" ]; then
		echo "FAIL $method $path -> HTTP $code" >&2
		cat "$tmp" >&2
		exit 1
	fi
	echo "ok $method $path -> HTTP 200"
}

request GET "/healthz"
jq -r '"healthz body: \(.)"' "$tmp"

request GET "/v1/financial-model"
jq -r '"model: \(.document.accounts | length) accounts, \(.document.postings | length) postings, \(.document.checkpoints | length) checkpoints, \(.issues | length) issues"' "$tmp"

request POST "/v1/sync/simplefin"
jq -r '"sync: \(.)"' "$tmp"
