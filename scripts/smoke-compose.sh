#!/bin/sh
set -eu

# Guest sample on the normal Casdoor stack. Owner checks live under auth/.

frontend_url=${FRONTEND_URL:-http://localhost:8080}
backend_url=${BACKEND_URL:-$frontend_url}
session=$(curl --fail --silent --show-error "${frontend_url}/v1/auth/session")
resource=$(printf '%s' "$session" | node --input-type=module -e '
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  const session = JSON.parse(data);
  if (!session.enabled || !session.allowed || session.resource?.kind !== "sample") process.exit(1);
  process.stdout.write(session.resource.id);
')

curl --fail --silent --show-error "${backend_url}/healthz" | grep -qx "ok"
curl --fail --silent --show-error "${backend_url}/readyz" | grep -qx "ok"
curl --fail --silent --show-error "${frontend_url}/" | grep -q 'id="root"'
missing_status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "${frontend_url}/settings")
test "$missing_status" = 404
rejected_origin_status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' \
	-H "Origin: http://unlisted.example" \
	-H "Waypoint-Resource: $resource" \
	"${frontend_url}/v1/status")
test "$rejected_origin_status" = 403
curl --fail --silent --show-error -H "Waypoint-Resource: $resource" "${frontend_url}/v1/status" | grep -q '"readOnly":true'
projection_request=$(curl --fail --silent --show-error \
	-H "Waypoint-Resource: $resource" "${frontend_url}/v1/financial-model" | node --input-type=module -e '
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  const model = JSON.parse(data).document;
  const start = model.checkpoints.map(row => row.Date).sort().at(-1) || new Date().toISOString().slice(0, 10);
  process.stdout.write(JSON.stringify({ settings: { fallbackProjectionStartDate: start, horizonYears: 1 }, config: { runCount: 1, seed: 42 } }));
')
sse_response=$(curl --fail --silent --show-error --no-buffer --max-time 120 \
	-H "Content-Type: application/json" \
	-H "Waypoint-Resource: $resource" -H "Origin: $frontend_url" \
	-X POST "${frontend_url}/v1/projections/stochastic" \
	--data "$projection_request")
printf '%s' "$sse_response" | grep -q 'event: result'
