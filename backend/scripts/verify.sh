#!/usr/bin/env bash
# Backend verify: gofmt -> go vet -> go test.
# Usage: verify.sh [--help] [package]   (default package: ./...)
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	echo "Usage: verify.sh [package]"
	echo "Runs gofmt (fail on output), go vet, and go test for one package (default ./...)."
	echo "CGO_ENABLED=0 is baked in."
	exit 0
fi

cd "$(dirname "$0")/.."
export CGO_ENABLED=0

pkg="${1:-./...}"
fmt_target="${pkg%/...}"
if [ -z "$fmt_target" ]; then
	fmt_target="."
fi

unformatted="$(gofmt -l "$fmt_target")"
if [ -n "$unformatted" ]; then
	echo "gofmt issues (run gofmt -w):" >&2
	echo "$unformatted" >&2
	exit 1
fi

go vet "$pkg"
go test "$pkg"
