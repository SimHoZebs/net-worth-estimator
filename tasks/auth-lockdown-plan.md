# Backend Access-Control Plan

## Objective

Protect canonical model writes and direct SimpleFIN triggers while preserving unauthenticated health checks, canonical reads, and projection computation. Keep access policy explicit at the server boundary and reversible through runtime configuration.

## Current Control Contract

| Control | Contract |
| --- | --- |
| read-only | `NET_WORTH_ESTIMATOR_READ_ONLY=1`, `true`, or `yes` rejects guarded writes with 403; unset or unrecognized values leave the server writable |
| bearer token | when `NET_WORTH_ESTIMATOR_AUTH_TOKEN` is non-empty, guarded writes require the exact `Authorization: Bearer <token>` value |
| comparison | bearer values are compared with `crypto/subtle.ConstantTimeCompare` |
| precedence | read-only rejection occurs before bearer validation |
| status | `GET /v1/status` reports `readOnly` and `authEnabled` without exposing the token |
| origins | `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS` accepts comma-separated exact HTTP/S origins |
| preflight | allowed methods are `GET`, `POST`, `PUT`, and `OPTIONS`; allowed request headers are `Content-Type` and `Authorization` |
| originless requests | requests without an `Origin` header are not rejected by the origin policy |

Guarded routes are exactly:

- `PUT /v1/financial-model`;
- `POST /v1/sync/simplefin`.

`GET /healthz`, `GET /v1/financial-model`, `GET /v1/status`, `GET /v1/income-data`, `POST /v1/projections/deterministic`, and `POST /v1/projections/stochastic` pass the write guard.

## Security Boundaries

### Canonical writes

`store.SaveDocument` atomically replaces owner model rows. A successful request can therefore change the canonical plan and its evaluation configuration.

Incoming checkpoint and posting `source` values are ignored. The store recomputes ownership, drops the reserved `sfin-` posting namespace, preserves stored `simplefin` rows, and lets owner checkpoints win account/date collisions. Access control protects the model-save boundary; it does not give model payloads control over sync-owned rows.

### Projection computation

Projection routes are intentionally unauthenticated. A successful deterministic or seeded stochastic request may write a best-effort `projection_artifacts` row. This cache write is derived data, not a canonical model mutation.

Rate limiting and resource limits for expensive stochastic requests belong at the deployment ingress or API boundary. Access-control documentation must not describe cache writes as owner-only canonical writes.

### Origin filtering

An origin allowlist is a request-origin policy, not authentication. It does not stop a direct API caller without an `Origin` header. Write authorization therefore cannot depend on the allowlist.

### Transport

Guarded endpoints require encrypted transport. A bearer token exposed over cleartext can be replayed. The service port should remain private behind the designated HTTPS terminator or equivalent trusted access layer.

## Persistence and Migration Rules

- SQLite is the canonical store. Keep one service instance and place the database on durable storage. A second writer can violate the intended deployment and scheduling discipline even though SQLite serializes transactions.
- Back up through SQLite-aware procedures. Stop writes or quiesce the service, checkpoint the WAL, and create a backup with `VACUUM INTO`; do not copy only the main database file while writes are active.
- Schema changes are forward-only, transactional, and data-preserving. Add one migration per schema step and a package test proving upgrade, rollback, and preserved data.
- Do not couple access-control rollout to an unrelated schema change. Deploy schema compatibility first, verify it, then change runtime policy.
- Canonical replacement is an explicit operator action through `backend/cmd/importcsv`; the HTTP API has no replacement route.
- Artifact eviction and schema migrations must not delete canonical or sync-owned rows.

## Rollout Plan

### Phase 0 — Prepare

1. Confirm the service has a persistent volume for SQLite.
2. Confirm the deployment has one service instance.
3. Create and verify a database backup.
4. Configure encrypted transport and verify the backend listener is not independently public when that is the intended boundary.
5. Generate the token with a cryptographically secure random source; store it in the platform secret store and never place it in tracked files or logs.
6. Set only the exact public origins that require direct access, without non-root paths, queries, fragments, credentials, or wildcards.

Acceptance evidence:

- `GET /healthz` returns 200 through the intended route.
- `GET /v1/status` reports the expected policy flags.
- An allowed preflight permits `Authorization`; a disallowed origin is rejected.
- The backup can be opened and its canonical model loads with `domain.ValidateFinancialModel`.

### Phase 1 — Read-only enforcement

Set `NET_WORTH_ESTIMATOR_READ_ONLY=1` and restart the service.

Verify:

- model save without a token returns 403;
- model save with any token returns 403;
- SimpleFIN trigger returns 403;
- canonical reads return 200;
- projection endpoints return 200 for valid inputs;
- the canonical model is byte-equivalent before and after rejected writes.

Acceptance evidence: the direct HTTP matrix in `TESTING.md` and `backend/internal/api/auth_test.go` cover precedence and state preservation.

### Phase 2 — Bearer enforcement while read-only

Deploy the secret-backed `NET_WORTH_ESTIMATOR_AUTH_TOKEN` while read-only remains enabled.

Verify:

- guarded requests with a missing token return 401;
- guarded requests with a malformed or wrong token return 401;
- guarded requests with the correct token still return 403 because read-only has precedence;
- `GET /v1/status` reports both `readOnly: true` and `authEnabled: true`;
- the token does not appear in status, health, error, or log output.

Acceptance evidence: `TestPutAuthMatrix`, `TestStatusReportsAuthEnabled`, and direct curl checks.

### Phase 3 — Controlled write restoration

Only after Phase 2 passes, clear `NET_WORTH_ESTIMATOR_READ_ONLY` and keep the bearer token configured.

Verify:

- save without a token returns 401;
- save with the wrong token returns 401;
- save with the correct token returns normal validation results;
- valid warning-only documents persist;
- error-severity documents do not persist;
- stored sync-owned rows survive model saves;
- an owner checkpoint can override a sync checkpoint at the same account/date key;
- a subsequent save cannot forge or delete sync-owned postings.

### Phase 4 — Trigger authorization

With a configured SimpleFIN runner, verify the same access matrix for `POST /v1/sync/simplefin`:

| Policy | Expected result |
| --- | --- |
| read-only | 403 |
| writable, token configured, missing/wrong bearer | 401 |
| writable, no token configured | normal runner result, including 503 when unconfigured |
| writable, correct bearer | normal runner result |
| active run | 409 |
| successful manual run under 20 hours old | 429 |

Keep dry-run enabled for the first policy check. Confirm the response counts are marked `dryRun: true` and no source row is committed.

## Secret Lifecycle

### Storage

- Store the token only in the deployment secret system.
- Do not log it, include it in command history, commit it, or return it through the API.
- Rotate by updating the secret and restarting the service. One configured token is accepted; dual-token overlap is outside this plan.

### Revocation

To revoke write access safely:

1. set read-only mode;
2. restart and verify guarded writes return 403;
3. replace or clear the token secret according to policy;
4. verify status and health without exposing secret values.

Clearing the token while the service remains writable disables authentication. Read-only must be enabled first.

### Rotation

1. Enable read-only mode.
2. Update the secret to the new token.
3. Restart.
4. Verify the old token returns 401 and the new token is accepted for a controlled write.
5. Restore writable mode only if required.

## Rollback

| Failure | Rollback action |
| --- | --- |
| valid operator cannot save | verify exact bearer format and token source; keep read-only while repairing configuration |
| token suspected exposed | enable read-only, rotate or revoke, verify 403, then decide whether writes should be restored |
| allowed origin rejected | correct the exact origin value; do not disable the entire HTTP policy |
| origin policy is not protecting direct callers | rely on bearer enforcement; add an appropriate trusted network boundary |
| persistence unhealthy | keep read-only, stop writers, restore or inspect the SQLite backup, run package verification, then cut back only after data checks pass |

## Completion Criteria

- The read-only/bearer/origin behavior is covered by `backend/internal/api/auth_test.go` and `backend/internal/api/cors_test.go`.
- Direct HTTP checks record the 401/403/200 matrix for both guarded routes.
- Read-only rejection leaves canonical state unchanged.
- A valid write round-trip preserves sync-owned rows and owner checkpoint precedence.
- A bearer-guarded SimpleFIN dry-run commits nothing.
- Status output exposes only policy booleans.
- No secret value appears in tracked files, test output, or service logs.
- Scoped production-package verification passes before rollout; the repository-wide gate remains blocked by the copy-only benchmark template described in `TESTING.md`.
