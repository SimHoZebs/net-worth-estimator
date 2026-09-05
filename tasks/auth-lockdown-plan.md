---
title: Backend lockdown (Plan A)
description: >
  Managed by kimaki session. Phase 0 (read-only kill switch) and Phase 1
  (single-token auth, reset deleted) implemented; reviewer findings addressed.
  SimpleFIN sync is parked as a separate Plan B and must not be folded in here.
---

# Plan A — Backend lockdown: read-only → single-token auth, no reset

## Problem

The Go backend is public-facing with zero auth. `PUT /v1/financial-model` and
`POST /v1/financial-model/reset` are world-writable, and the CORS allowlist
does not stop non-browser clients (`backend/internal/api/cors.go` passes
requests without `Origin` straight through). Anyone can replace or wipe the
canonical SQLite DB.

## Non-goals (explicit)

- No editor/admin role split. One bearer token, one permission: write.
- No SimpleFIN work in this plan (parked as Plan B; it needs its own
  justification plus a migration design for source-owned rows).
- Session-only `ModelOverrides`, `resetCurrentChanges`, seed-on-first-boot,
  and the offline `cmd/importcsv` operator tool are untouched.

## Phase 0 — Read-only kill switch (ship alone)

- `NET_WORTH_ESTIMATOR_READ_ONLY` env flag. Unset/empty = writable (dev
  default, fail-open by choice); `1`/`true`/`yes` = read-only.
- When read-only, `PUT /v1/financial-model` and `POST /v1/financial-model/reset`
  return **403** with a machine-readable reason, before validation or writes.
- New `GET /v1/status` → `{ "readOnly": bool, "authEnabled": false }`.
  (`authEnabled` ships as `false` now so the client does not churn in Phase 1.)
- Client: `App` fetches status once and strips `save`/`reset` capabilities from
  the repository object when `readOnly` is true, so Save/Reset UI hides instead
  of failing on click (existing `App.tsx` capability-presence branching).
- Deploy prod with `READ_ONLY=1`; dev stays unset.
- Status matrix (Phase 0): anonymous PUT, read-only → 403; anonymous PUT,
  writable → legacy behavior. No 401s exist yet (no auth).

## Phase 1 — Single token, delete reset

- New `NET_WORTH_ESTIMATOR_AUTH_TOKEN`. `requireAuth` chi middleware on
  `PUT /v1/financial-model` only → **401** without a valid bearer (constant-time
  compare). Reads and compute POSTs stay public.
- Status matrix (Phase 1): `READ_ONLY=1` denies writes even with token (kill
  switch wins); no token → 401; valid token → normal handling.
- **Delete reset entirely**: route, `resetModel` handler, `SeedModelPath` /
  `SeedIncomePath` server config (boot-seed paths stay in `main.go`), client
  reset action/mutation/button (`httpFinancialModelRepository`,
  `useFinancialModelResetMutation`, `App.tsx`, `SourceStatusCard`), and all
  referencing tests/docs. `Store.Clear` stays for test use only. CSV files
  become seed-only (first boot + `cmd/importcsv`).
- **CORS**: add `Authorization` to allowed headers + update `cors_test.go`
  (today it asserts `Authorization` preflight is rejected). Verify from a
  prod-like Origin-preserving setup before go-live — dev proxy strips Origin
  and hides this.
- **TLS is a fail-closed go-live gate**: name the terminator, probe https +
  HSTS, confirm the backend port is not directly public. No token goes live
  before this. Token lifecycle: CSPRNG generation, env/secret-manager storage,
  never logged, rotation/revocation procedure documented.
- Client: token field in Settings (persisted in browser localStorage, never
  logged, sent only on save), `Authorization` header on save only, 401 hint UI.
- Rollout runbook: deploy auth → verify authed PUT via curl → verify
  unauthenticated 401 → verify reads unaffected → only then unset `READ_ONLY`.

## Out of scope but recorded (reviewer findings)

- Projection/analysis POSTs write `projection_artifacts` cache rows on miss.
  "Owner-only writes" therefore means *canonical model rows*; cache writes are
  best-effort and need proxy rate limits (stochastic SSE is CPU-heavy). Do not
  claim more.
- Future migrations: forward-only, transactional, data-preserving, one Go test
  per migration; backups via WAL checkpoint + `VACUUM INTO`, never raw file copy.

## Verification per phase

- `cd backend && go test ./...`
- `npm run test:run`, `npm run typecheck`
- Phase 0: handler tests for 403 matrix + status flag both values; client test
  for capability stripping; live `curl -X PUT` probe against prod.
- Phase 1: 401/403/200 matrix per route; CORS preflight test with
  `Authorization`; TLS probe before enabling the token.
