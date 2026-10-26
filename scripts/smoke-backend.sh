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
: "${COOKIE_FILE:?Set COOKIE_FILE to a private disposable owner-session cookie jar}"
: "${RESOURCE_ID:?Set RESOURCE_ID from session discovery}"
: "${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN to the configured frontend origin}"
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
	code="$(curl -sS --cookie "$COOKIE_FILE" -H "Waypoint-Resource: $RESOURCE_ID" \
		-H "Origin: $PUBLIC_ORIGIN" -o "$tmp" -w '%{http_code}' -X "$method" "$base$path")"
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

# SimpleFIN sync stays unconfigured until a key is connected through
# POST /v1/sync/simplefin/credential (setup token or access URL). That is a
# pass when unconfigured; a green run with sync needs a connected key.
echo "skip POST /v1/sync/simplefin (connect a key through POST /v1/sync/simplefin/credential first)"
request GET "/v1/sync/simplefin/credential"
jq -r '"credential: \(.)"' "$tmp"
