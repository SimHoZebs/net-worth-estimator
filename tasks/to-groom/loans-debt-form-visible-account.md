# Loans debt-form visible-account assertion fails in shard 2/4

Status: backlog (filed with landing of feat/mitul-category-arm; needs a frontend owner)

## Symptom

`tests/integration/loans.spec.ts:57` — "one debt form creates one visible account and preserves terms on edit" fails on `expect(locator).toBeVisible()` for the `$237.54` text in the Account details region (10s timeout, element not found).

## Reproduction

- Branch runs for an eval-only change (no frontend, loans, or API surface touched): run `43372392628` (initial + `--failed` retry) and rebased run `43374388125` — shard 2/4 fails the same test ID `15b031f8c79b5615c87d` all three times.
- Same test fails identically on `origin/main` at `2dfbc5dc` (run `43372812602`, shard 2, run-2520): same file, line, title, and `toBeVisible` failure shape.
- Artifacts: `integration-artifacts-shard-2` run zips on each run carry `results.json`, `error-context.md`, `test-failed-1.png`, and the Playwright trace.

## Why it is independent of the landing change

The landing diff touches only the offline eval harness, eval docs, and the baked ML seed. Nothing in the loans UI, API routes, store, or projection paths changed. The failure reproduces on main without the landing.

## Suggested next step

Frontend owner triages: stale `$237.54` expectation versus a rendering race in the account-details region. If it is a race, the usual quarantine-or-retry policy for browser timing flakes applies; if the expectation moved with the recent account-display changes, update the assertion.
