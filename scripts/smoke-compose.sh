#!/bin/sh
set -eu

# Legacy unauthenticated stack only. Casdoor checks live under auth/.

frontend_url=${FRONTEND_URL:-http://localhost:8080}
backend_url=${BACKEND_URL:-http://localhost:8787}

curl --fail --silent --show-error "${backend_url}/healthz" | grep -qx "ok"
curl --fail --silent --show-error "${frontend_url}/" | grep -q 'id="root"'
curl --fail --silent --show-error "${frontend_url}/settings" | grep -q 'id="root"'
rejected_origin_status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' \
	-H "Origin: http://unlisted.example" \
	"${frontend_url}/v1/status")
test "$rejected_origin_status" = 403
curl --fail --silent --show-error "${frontend_url}/v1/status" | grep -q '"readOnly"'
sse_response=$(curl --fail --silent --show-error --no-buffer --max-time 120 \
	-H "Content-Type: application/json" \
	-X POST "${frontend_url}/v1/projections/stochastic" \
	--data '{"settings":{"horizonYears":1},"config":{"runCount":1,"seed":42}}' || true)
printf '%s' "$sse_response" | grep -q 'event: progress'
