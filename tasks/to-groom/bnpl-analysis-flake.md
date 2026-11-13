# BNPL analysis assertion flakes in shard 1/4

Status: backlog (observed across branch and main runs Nov 13; needs a frontend owner)

## Symptom

`tests/integration/analysis.spec.ts` — "Yes confirms BNPL, collects total duration, and preserves the financial model" fails intermittently in shard 1/4 and passes on retry with no code change.

## Reproduction

- Branch run `43374388125` (feat/mitul-category-arm-r2, eval-only diff): shard 1 failed, then passed on `--failed` retry.
- Main run `43377262515` (landed `4f2aa4f`): shard 1 failed with the same test.
- Never fails twice in a row on identical code; no backend, eval, or seed change in either diff touches analysis or BNPL paths (ML service tests stay green throughout).

## Suggested next step

Treat as a timing flake unless it starts failing consecutively: quarantine or retry the spec, same as the loans shard-2 entry in `loans-debt-form-visible-account.md`.
