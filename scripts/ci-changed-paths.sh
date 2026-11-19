#!/usr/bin/env bash
# Prints true when an event needs the executable-code gates and false for a
# docs-only change. Run from the repository checkout with these variables:
#   EVENT_NAME, BEFORE, BASE_SHA, HEAD_SHA, SHA, DEFAULT_BRANCH
# CI_CLASSIFIER can point at the classifier for local tests.
set -euo pipefail

classifier="${CI_CLASSIFIER:-scripts/ci-code-gate.mjs}"
default_branch="${DEFAULT_BRANCH:-main}"

# Dispatch has no changed-path context and is the operator escape hatch.
if [ "${EVENT_NAME:-}" = "workflow_dispatch" ]; then
  printf 'true\n'
  exit 0
fi

if [ "${EVENT_NAME:-}" = "pull_request" ]; then
  base="${BASE_SHA:-}"
  head="${HEAD_SHA:-}"
  # Three-dot uses the merge base of base and head, so the diff is the PR's
  # own content even when base has moved on.
  range="${base}...${head}"
else
  head="${SHA:-}"
  before="${BEFORE:-}"
  if [ -z "$before" ] || [ "${before//0/}" = "" ]; then
    # A new branch has no usable "before". Compare with the point where it
    # left the default branch so a docs-only first push still skips the gates.
    git fetch --no-tags origin "$default_branch" >/dev/null 2>&1 || true
    ref="origin/$default_branch"
    git rev-parse --verify "$ref" >/dev/null 2>&1 || ref="$default_branch"
    base="$(git merge-base "$ref" "$head" 2>/dev/null || true)"
  else
    base="$before"
    # A force push has no trustworthy delta; run the gates.
    if ! git merge-base --is-ancestor "$before" "$head" 2>/dev/null; then
      printf 'true\n'
      exit 0
    fi
  fi
  # Two-dot compares the pushed commits directly, without the merge-base
  # rewriting that a PR's three-dot range needs.
  range="${base}..${head}"
fi

if [ -z "${base:-}" ] || [ -z "$head" ]; then
  printf 'true\n'
  exit 0
fi

# NUL-delimited names survive spaces and newlines in paths. pipefail and the
# empty-input rule in the classifier make any failure run the gates.
if ! code="$(git diff -z --no-renames --name-only "$range" 2>/dev/null | node "$classifier")"; then
  code=true
fi
printf '%s\n' "$code"
