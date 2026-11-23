# Backend API/persistence LOC reduction audit (read-only)

Relevant scope: `backend/internal/api/*`, `backend/internal/store/*`, `backend/internal/simplefin/*`, `backend/cmd/server/*`

## Finding 1: Repeated HTTP error wrappers in sync API handlers
**Background**
The SimpleFIN sync HTTP layer (`internal/api/sync/handlers.go`, `account_links.go`) calls `huma.Error500InternalServerError(err.Error())` many times with almost identical code. The same pattern appears across `internal/api/model/*` (e.g. 21 times), `internal/api/projections/*`, and `internal/api/status.go`. The error mapping is mostly mechanical string passthroughs.

**Direct change**
Extract a small helper (e.g. `internal/api/sync/errors.go` with `internalError(err error) error { return huma.Error500InternalServerError(err.Error()) }` or just inline consistently) or reuse a shared helper. Also consider `modelstate.WriteError` pattern for store errors - some places already use it (`account_links.go` uses `modelstate.WriteError` on store errors), others duplicate store->HTTP mapping. Consolidate to avoid duplication while preserving exact messages and status codes.

**Source evidence**
- `backend/internal/api/sync/handlers.go:65,107,153,174,182,211,225` - multiple `huma.Error500InternalServerError(err.Error())`
- `backend/internal/api/sync/account_links.go:20,53,68,84` - same pattern
- `backend/internal/api/model/queries.go:79,83,117,221,225,...` - repeated
- `backend/internal/api/model/writes.go:~100-160` does load/model errors directly
- `backend/internal/api/internal/modelstate/modelstate.go:16-39` already provides `WriteError` for store errors (not found/conflict/id format/sync-owned/account missing) mapping to specific statuses

**Verification**
- API responses for error cases unchanged (status codes/messages identical)
- Run API tests: `backend/internal/api/...` tests compile and pass
- Grep confirms no new error paths introduced

## Finding 2: TriggerSync error mapping is verbose but structured; consider consolidation
**Background**
`triggerSync` in `internal/api/sync/handlers.go:39-68` does explicit type switches over `*simplefin.NotConfiguredError`, `*simplefin.TooSoonError`, `*simplefin.RateLimitedError`, `*simplefin.InProgressError` mapping to 503/429/409/500. The error types are defined in `internal/simplefin/runner.go`. Mapping is correct but could be table-driven or a small mapper to reduce LOC.

**Direct change**
Add `mapSyncError(err error) error` in sync package to centralize mapping; keep behavior identical.

**Source evidence**
- `backend/internal/api/sync/handlers.go:43-67`
- `backend/internal/simplefin/runner.go:49-72` (error types)
- `backend/internal/api/sync/handlers.go:21-38` has `retryAfterHeader`/`tooManyRequests` helpers

**Verification**
- 429 includes Retry-After header (existing logic preserved)
- All error cases map to same status codes/messages
- Sync API tests pass

## Finding 3: SimpleFIN runner duplication in guard logic (Sync vs Trigger)
**Background**
`Runner.Sync` and `Runner.Trigger` in `internal/simplefin/runner.go` share similar guard structure: lock, check `inFlight`, check blackout (`limitedUntil`), possibly check interval for Trigger, set `inFlight`, call `fetchAndApply`, then unlock and handle rate limit -> set blackout/return TooSoon or on success update `lastTrigger` (Trigger only). The flow is duplicated.

**Direct change**
Extract a shared helper like `runWithGuards(ctx context.Context, mode guardMode) error` that takes a mode (sync/trigger) to enforce interval. This reduces duplication while preserving exact semantics (Sync does not stamp lastTrigger, Trigger stamps only on success, both share singleflight and blackout).

**Source evidence**
- `backend/internal/simplefin/runner.go:220-246` (Sync)
- `backend/internal/simplefin/runner.go:359-402` (Trigger)
- Comments explain differences explicitly

**Verification**
- Scheduler calls `Sync()` directly - must remain unchanged
- Manual trigger via API uses `Trigger()` - interval enforcement unchanged
- Blackout/rate-limit behavior unchanged (both return `*TooSoonError` on local refusals)
- Tests in `internal/simplefin/*_test.go` (runner_test, sync_flow_test, protocol_rate_limit_test) pass

## Finding 4: Credential resolution/fetch logic is reasonable but could share patterns
**Background**
`fetchWithCredential` resolves credential each call; `NewRunner` supports both injected client and provider. The code is clear. No obvious large duplication.

## Finding 5: SQLite sync re-merge helpers duplication
**Background**
In `internal/store/adapters/sqlite/sync.go`, `remergeCheckpoints` and `remergeTransactions` have similar structure (build maps, iterate incoming, skip if synced-owned in some cases, append). Also position management via `nextTablePosition`. The patterns are similar but differ in keying and insert logic.

**Direct change**
Consider a small generic helper only if types align cleanly without adding complexity; probably not worth it. The duplication is moderate.

**Source evidence**
- `backend/internal/store/adapters/sqlite/sync.go:31-102`

**Verification**
- Sync re-merge behavior unchanged (owner wins at same instant, sync rows preserved/restored as before)
- Tests related to sync/apply pass

## Finding 6: Account links API repeats store error mapping
**Background**
`account_links.go` returns raw `huma.Error500InternalServerError` for `ListAccountLinks` and revision fetch errors instead of using the shared `modelstate.WriteError` mapping. Inconsistent style - could normalize.

**Direct change**
Use consistent error handling; `modelstate.WriteError` covers common store errors. For generic errors, still use 500 but maybe centralize.

**Source evidence**
- `backend/internal/api/sync/account_links.go:18-28,44-74,76-89`

**Verification**
- Error responses unchanged

## Finding 7: API server wiring has repeated patterns
**Background**
`internal/api/server.go` wires routes in a fixed order. Each subpackage has `Register`. No major duplication obvious.

## Summary of LOC reduction opportunities (concrete)
- **Sync API error handling**: create `internal/api/sync/errors.go` with helpers to map errors and normalize responses -> save ~40-60 LOC across handlers/account_links
- **SimpleFIN Runner guards**: extract shared guard logic -> save ~30-40 LOC, improves maintainability
- **Model API**: many 500s could use helper, but need to be careful about message formatting (some pass `err.Error()` directly)

Total estimated reduction: ~65-100 LOC without behavior changes if done carefully.

## Recommendations
1. Start with sync API helpers (low risk, localized)
2. Refactor SimpleFIN Runner guard duplication (core logic, needs careful testing)
3. Consider shared API error helpers in `internal/api/internal/` or per-package
4. Avoid over-abstracting SQLite re-merge unless tests show benefit
