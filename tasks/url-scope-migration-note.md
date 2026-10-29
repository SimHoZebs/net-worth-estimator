# Backlog: absolute-path account scope for the API

Status: decided against for now. Revisit only with a concrete trigger
(audit finding, gateway requirement). Do not implement speculatively.

## Context

Financial row endpoints are scope-relative (`/v1/accounts/checking`).
The intended user travels in the `Waypoint-Resource` header, asserted
per request against the session-derived scope. Mismatch returns 409
`RESOURCE_CHANGED` before any store opens. This was challenged: why not
put the user in the URL path and let the per-call Casdoor permission
check reject cross-user writes?

## Assessment

The per-call permission check already runs. It checks the actor against
the session-derived scope, so it cannot catch scope confusion: the
confusion happens at scope selection, before permissions run. Moving the
scope into the path (`/v1/accounts/{account}/...`) moves the client's
statement of intent from header to URL. The middleware must still compare
the stated scope against the session or the grant. The comparison is
irreducible. Fusing the two (authorize the stated scope instead of the
session scope) changes the stale-tab error from 409 to 403 and nothing
else, while 403 must then also drive workspace-swap recovery, which is
more client logic, not less.

## Sketch if ever revived

- Path form: `/v1/accounts/{ref}/...`, ref = `<64hex>` or `sample`.
  Server maps to `accounts/<ref>` (Casdoor) and `user:<ref>`/`sample`
  (store). `GET /v1/auth/session`, `/v1/auth/*`, `/v1/groups/*`,
  `/healthz`, `/v1/status` stay top-level.
- Middleware parses the ref, validates shape, authorizes
  (session actor, path resource, action) via Casdoor. No session-equals
  shortcut, or the purity argument collapses.
- Delete `Waypoint-Resource` request/response headers, 409 machinery,
  `RequireResourceHeader`. Client: on 403, reverify session once; if the
  verified resource differs from the displayed scope, swap workspace,
  else show denial.
- Blast radius: ~46 v1 paths in ~25 `backend/internal/api` handler
  files, OpenAPI snapshot regen plus orval client regen, every
  generated-client call site, `scopedRequest`/`waypoint-fetch`,
  session discovery, mocks, all browser specs, smoke scripts,
  `auth/test-integration.mjs`, docs and TESTING.md curl examples.
- Account IDs in URLs leak into history, bookmarks, and logs. Accept
  that before starting.
