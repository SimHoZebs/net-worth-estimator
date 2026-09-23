#!/usr/bin/env bash
# Single Northflank service health view: service + running containers +
# latest build + runtime env var NAMES only (values are secrets, never printed).
# Usage: nf-status.sh [--help] [--service ID] [--project ID]
# Defaults: $NORTHFLANK_SERVICE (net-worth-estimator), $NORTHFLANK_PROJECT (nedon).
set -euo pipefail

service="${NORTHFLANK_SERVICE:-net-worth-estimator}"
project="${NORTHFLANK_PROJECT:-nedon}"

while [ $# -gt 0 ]; do
	case "$1" in
		-h | --help)
			echo "Usage: nf-status.sh [--service ID] [--project ID]"
			echo "Prints service health and latest build; redacts all secret values."
			exit 0
			;;
		--service)
			service="${2:?--service needs a value}"
			shift 2
			;;
		--project)
			project="${2:?--project needs a value}"
			shift 2
			;;
		*)
			echo "unknown flag: $1 (see --help)" >&2
			exit 2
			;;
	esac
done

if ! command -v northflank >/dev/null 2>&1; then
	echo "error: 'northflank' CLI not found on PATH; install it and run 'northflank login' first." >&2
	exit 127
fi
if ! command -v jq >/dev/null 2>&1; then
	echo "error: 'jq' not found on PATH; install jq first." >&2
	exit 127
fi

flags=(--service "$service" --project "$project" -o json --quiet)

echo "== service $service (project $project) =="
northflank get service "${flags[@]}" | jq -r '
	"name:            \(.name // "unknown")",
	"type:            \(.serviceType // "unknown")",
	"region:          \(.region // "unknown")",
	"branch:          \(.deployment.internal.branch // "unknown")",
	"deployed sha:    \(.deployment.internal.deployedSHA // "unknown")",
	"build id:        \(.deployment.internal.buildId // "unknown")"
'

echo "== containers (running) =="
northflank get service containers "${flags[@]}" |
	jq -r '[.containers[] | select(.status == "TASK_RUNNING")] | if length == 0 then "none running" else (.[] | "\(.status)  \(.name)") end'

echo "== latest build =="
northflank get service builds "${flags[@]}" --per_page 1 |
	jq -r '.builds[0] | "\(.status // "unknown")  \(.id // "?")  \(.branch // "?")@\(.sha // "?" | .[0:12])  \(.createdAt // "")\n\(.message // "")"'

echo "== runtime env (names only, values redacted) =="
northflank get service runtime-environment "${flags[@]}" 2>/dev/null |
	jq -r '.runtimeEnvironment // {} | keys_unsorted[]'
