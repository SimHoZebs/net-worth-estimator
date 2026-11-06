# SimpleFIN v2 migration: connection-scoped account keys

Status: implemented. Current contracts live in `backend/internal/simplefin/`, `backend/internal/store/`, `deploy/MIGRATIONS.md`, and `TECHNICAL_OVERVIEW.md` §11. This file records the plan and its accepted scope.

## Decision

Adopt SimpleFIN protocol 2 as the only protocol the sync speaks, and make
the bridge account identity connection-scoped in the same change.

Ship it in two releases:

1. **Release A (reversible).** Fetch with `version=2`, require the v2 response
   shape, remove v1 `errors` parsing, and gate sync application on structured
   `errlist` errors. Keep the existing bare `account.id` keys.
2. **Release B (the one-way door).** Rewrite every stored bridge account key
   to a connection-scoped key and delete the bare-key path. The offline data
   conversion in this release is the point of no return.

There is no dual-protocol mode, no v1 fallback, and no runtime reader for
both key formats. After Release B, rollback is restoring the pre-migration
backup and running Release A; reverting code alone is not enough.

## What actually changes in v2

Live checks against the Bridge on 2026-11-05:

| Request | Result |
| --- | --- |
| `/accounts` without `version` | v1 shape: `errors`, no `errlist`, no `connections`, no `conn_id` |
| `/accounts?version=2` | `errlist`, `connections`, `conn_id` on each account, no `errors` |
| `/simplefin/info` | reports `{"versions":["1.0"]}` while `version=2` works |
| demo account IDs, v1 vs v2 | identical |
| `/accounts?version=2` with bad credentials | HTTP 403 with `{"errlist":[{"code":"gen.auth","msg":"Forbidden"}]}` |

The protocol delta that matters here:

- `errors` is replaced by structured `errlist` entries with `code`, `msg`,
  optional `conn_id`, and optional `account_id`.
- `connections` is a required top-level list; `Account.conn_id` scopes the
  account identity to one connection.
- `account.id` is only guaranteed unique **within a connection**. The current
  code treats it as unique across the whole access URL.
- `balances-only=1`, `account=`, and the planned merchant category code are
  not needed by this sync.

`/info` is not a reliable negotiation gate. Require the v2 response markers
instead.

## Current state

The client sends no `version` parameter, so the Bridge serves v1. The
`AccountSet` type already parses `errlist`, but it still reads the deprecated
`errors` list and ignores both `connections` and `conn_id`.

The bridge account identity is the bare `account.id` everywhere:

- `account_links.bridge_account_id`
- `transaction_sync_keys.bridge_account_id`
- `suppressed_sync_keys.bridge_account_id`
- `ProviderAccountID` and `Checkpoint.BridgeID`
- the account link API path and the Analysis transaction account identity

Error handling currently inspects only rate-limit messages. A v2 response with
HTTP 200 and `con.auth` or `act.failed` would apply an incomplete snapshot and
still stamp a successful sync. That is the safety problem v2 lets us fix.

## Alternatives considered

- **Keep bare account IDs and add only a collision guard.** Rejected. The
  protocol does not guarantee uniqueness across connections, a collision means
  the old schema already merged two accounts, and there is no good product
  answer after the fact.
- **Add a separate `bridge_conn_id` column and a two-segment API path.**
  Rejected. Arbitrary account IDs would need path escaping, and it touches
  three primary keys plus the frontend for no additional safety over the
  encoded key.
- **Purge all SimpleFIN rows and re-sync.** Rejected as the primary path. It
  discards relinking choices and suppressed/void state. Keep it as the
  documented fallback for a genuine collision.

## Target protocol contract

Every `/accounts` request sends `version=2`. A response without both `errlist`
and `connections` is invalid protocol input and fails the sync. It is never
treated as a successful empty set.

`Connection` carries `conn_id`, `name`, `org_id`, `org_name`, `org_url`, and
`sfin_url`. `Account` carries `conn_id`. The deprecated `errors` field is
deleted from the Go type.

Error policy:

| Error class | Apply policy |
| --- | --- |
| `gen.auth` | Fail the whole run. Return an authentication error; ask the user to reconnect. |
| other `gen.*` | Fail the whole run. Return a sanitized protocol error. |
| `con.*` | Exclude every account in that connection. Keep other connections syncing. |
| `act.*` | Exclude that account. Keep other accounts syncing. |
| unknown prefix | Fail the whole run. |
| rate-limit message or code | Keep the existing 429 plus `Retry-After` backoff. |

A connection-scoped or account-scoped error without its `conn_id` or
`account_id` is treated as a general error and fails the run. An empty code is
also general. This avoids dropping rows on an ambiguous error.

Excluded accounts and connections are not provisioned, do not contribute
checkpoints or directives, and are not marked covered. Because they are not
covered, their pending holds are not voided by an incomplete snapshot.

A partial run applies healthy accounts, stamps the last successful sync time,
and records the sanitized errors. A full run clears the stored error. An
authentication failure does not stamp success.

HTTP 402 from `/accounts` becomes a distinct payment-required error. HTTP 403
is parsed for `gen.auth` before falling back to a status error.

The trigger response adds `errors` and `partial`. `GET /v1/status` adds an
optional `syncError` object with code, message, and time. The UI shows a
warning notice for a partial run and a reconnect action for auth errors.

## Target identity contract

The canonical bridge account key is:

```text
sf2.<base64url(conn_id)>.<base64url(account_id)>
```

Use unpadded base64url (`RawURLEncoding`) so the key contains no `=`.

Properties:

- URL-safe, so the existing `/accounts/{bridgeAccountId}` path continues to
  work without escaping.
- Collision-free because base64url never contains the `.` separator.
- Reversible for debugging and audit output.
- No schema change and no primary-key change.
- The same account ID under two connections produces two distinct keys.

The key replaces the bare account ID in all three sync tables, in
`ProviderAccountID`, `Checkpoint.BridgeID`, and the Analysis account identity.
The API field name `bridgeAccountId` stays the same, but its value becomes the
opaque key. The browser already treats it as opaque, so the visible UI does not
change; scripts that hard-coded a bridge account ID do.

A changed `conn_id` is a new identity. The old account stays stale with its
rows, and the user can use the existing supersede action to merge a manual or
old account into the new synced account.

The SimpleFIN runner rejects a stored account link that is not a valid v2 key
before it fetches. That prevents a skipped migration from silently
auto-provisioning duplicate accounts.

## Release A (reversible)

Scope:

- Send `version=2`; require `errlist` and `connections`.
- Add `Connection` and `Account.ConnID`; remove `Errors`.
- Add error classification, exclusion, partial-run reporting, and 402/403
  handling.
- Keep the bare `account.id` key and all existing data. The additive
  `checkpoint_available_balances` sidecar ships in the same release; it stores
  the Bridge's separate available figure without changing the checkpoint
  table shape.
- Add persisted last-sync error and the UI notice. The condition lives in
  the existing `provider_connections.status` row for `simplefin`, so no new
  schema is needed. A clean run clears it; `GET /v1/status` exposes it.
- Update protocol tests and docs that still describe v1.

Exit gate:

- A live owner sync on the demo access URL returns v2 data and applies the same
  balances and transactions as the v1 run.
- `gen.auth`, `con.auth`, `act.failed`, unknown-code, and rate-limit cases are
  covered by tests.
- A partial run does not void pending holds for the excluded account.
- The branch `Tests` run is green and the release is deployed before the key
  work starts.

Release A can be rolled back by redeploying the previous image. No key or
browser-storage format changes; the additive `sync_state` columns remain
harmless to the previous image.

## Release B (the one-way door)

Scope:

- Compute the canonical key from `conn_id` plus `account.id` in provisioning,
  translation, checkpoints, directives, and Analysis.
- Convert the three existing key tables with the offline tool.
- Reject leftover bare keys at sync start.
- Delete bare-key tests and fixtures.

The conversion is all-or-nothing and happens with the API and scheduler
stopped. The tool does not touch model rows, balances, transactions, facts,
categories, claims, or sharing rows. It only rewrites external identity
strings.

### Key map tool

Add a read-only preflight command, `simplefin-v2-map`, that:

- Opens the database read-only and lists every user with SimpleFIN links or
  sync keys.
- Reads that user's stored access URL and fetches
  `/accounts?version=2&balances-only=1`.
- Requires the v2 response markers.
- Writes a private `mapping.json` (mode 0600) with the connection list and the
  `account.id -> conn_id` map. It never writes the access URL.
- Aborts with a nonzero exit if one account ID appears under two connections,
  or if a user with SimpleFIN rows has no usable credential.
- Counts as one Bridge hit per user, so run it away from a scheduled sync and
  keep it inside the 24-per-day quota.

Run it before the maintenance window and keep the mapping with the migration
record. A second run should produce the same account set; if it does not,
regenerate it. This preflight is the only provider read in the migration; the
conversion tool never contacts the Bridge.

### Key conversion tool

Add an offline command, `upgrade-simplefin-v2-keys`, with `--db`, `--mapping`,
and `--dry-run`.

It:

- Refuses a missing, symlinked, or non-regular database and a hot rollback
  journal.
- No-ops when no `simplefin` rows exist.
- Maps every distinct key in `account_links`, and every
  `provider='simplefin'` key in `transaction_sync_keys` and
  `suppressed_sync_keys`.
- Assigns a stale account that is absent from the live map to the user's only
  connection when that user has exactly one connection. Aborts when the user
  has multiple connections or none.
- Aborts before mutation on any unmatched or ambiguous key.
- Runs one `BEGIN IMMEDIATE` transaction, rewrites all three tables, verifies
  row counts are unchanged and no bare keys remain, records
  `schema_migrations('simplefin-v2-keys')`, and commits.
- Is idempotent: a marked database repeats read-only verification.

The tool runs against the verified candidate database inside the existing
`deploy/migrate.sh` body, before `setupdb` validation. The mapping path comes
from a private runtime setting, never a command argument or log. Update
`deploy/MIGRATIONS.md` with the source and target key states and the mapping
requirement.

### Collision and stale-link rules

An account ID that appears under two connections is a real collision. The old
schema merged the two accounts, so the correct rows cannot be recovered by
rewriting keys. Abort the migration, purge that user's SimpleFIN-owned rows
with the existing purge procedure, and re-sync under v2. This is a product
decision only in the sense that it loses relinking choices; it never guesses.

A stale link with one connection is safe to bind to that connection. A stale
link with multiple connections aborts the migration and lists the affected
users. The operator either removes the stale link or purges that user's sync
rows before retrying.

## Cutover runbook

Before the window:

1. Generate and review the mapping. Record user, connection, account, and link
   counts. Confirm zero collisions and zero ambiguous stale links.
2. Run the conversion tool with `--dry-run` against a copy of the production
   database. Confirm unchanged row counts and the expected converted count.
3. Rehearse the full candidate migration, `setupdb` validation, publication,
   and Release B startup on disposable state.
4. Take a verified SQLite backup with integrity and foreign-key checks. Keep
   it private and immutable.

In the window:

1. Pause deploy triggers and every API writer, including the scheduler.
2. Confirm no sync is in flight and no rollback journal exists.
3. Run `deploy/migrate.sh` on the candidate, including the key conversion.
4. Verify every `simplefin` key has the `sf2.` shape, every table count is
   unchanged, and the model bytes are unchanged.
5. Publish the candidate and start Release B.
6. Confirm readiness, `GET /v1/sync/simplefin/accounts`, and a manual sync.
   Compare balances and pending rows with the pre-migration state.
7. Confirm a second trigger inside the interval still returns 429, and that
   no duplicate synced accounts appeared.

Rollback:

| Point | Action |
| --- | --- |
| Before the key tool commits | Stop Release B, redeploy Release A, database unchanged. |
| After the key tool commits, before new syncs | Restore the verified backup, redeploy Release A. |
| After new syncs | Restore the backup and accept loss of writes after the backup, or reconcile them by hand. There is no old-code reader for v2 keys. |

## Verification

Protocol and adapter:

- v2 query parameter is sent.
- Missing `errlist` or `connections` is rejected.
- v1 `errors`-only bodies are rejected.
- `gen.auth`, `con.auth`, `act.failed`, unknown codes, 402, and 403 bodies.
- Rate limit still maps to 429 and backoff.
- Two connections with the same account ID produce two keys.
- An errored connection or account is not provisioned, not covered, and does
  not void pending holds.
- A partial run stamps success and records the error; a full run clears it.

Store and API:

- Key round-trip and invalid-key rejection.
- Link, unlink, and supersede with a connection-scoped key.
- Analysis grouping keeps same-ID accounts from different connections apart.
- `GET /v1/sync/simplefin/accounts`, `GET /v1/status`, and the trigger
  response shapes.

Frontend:

- Existing link and supersede journeys work with a dotted v2 key.
- Partial-sync warning and auth reconnection notice.
- A screenshot or clip of the changed provider surface.

Migration tool:

- Fresh database with no SimpleFIN rows is a no-op.
- Two users remain isolated.
- Link, transaction, and suppressed keys all convert; counts are preserved.
- Re-run is read-only.
- Collision, ambiguous stale link, missing credential, missing mapping, and
  v1-only server all abort without mutation.
- A failed transaction leaves the database unchanged.

Commands:

```bash
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./cmd/server
CGO_ENABLED=0 go -C backend test ./internal/ingest ./internal/integrationledger
node --test deploy/migrations.test.mjs
bun --filter ./frontend test:unit
bun --filter ./frontend test:integration
```

Then follow the hosted `Tests` workflow for the exact branch commit. For the
live Bridge check, use the SimpleFIN section in `TESTING.md` with a writable
owner and a real access URL. Take a screenshot of the provider panel after the
partial-error behavior is exercised.

## Non-goals

- `balances-only=1` or `account=` requests. The sync needs all transactions,
  and per-account requests have their own quota.
- Merchant category codes. The Bridge does not provide them; `extra.category`
  stays provider-specific evidence.
- `/info` negotiation.
- Multi-protocol or dual-key support.
- Persisting and displaying every connection name. Connections are parsed for
  error attribution; display names stay ephemeral.
- Replacing the SimpleFIN sync with a generic provider framework.

## Risks

| Risk | Mitigation |
| --- | --- |
| Bridge v2 is unavailable for a target | Release A fails before the door; stop and keep v1. |
| Same account ID under two connections | Map tool aborts; purge and re-sync that user. |
| Stale link with multiple connections | Abort and require explicit cleanup. |
| Mapping drifts between preflight and window | Conversion aborts on unmatched keys; regenerate. |
| Opaque key breaks a hidden client assumption | Frontend treats it as opaque; add a dotted-key integration test; document the API value change. |
| Partial sync hides a broken connection | Error gating plus status/UI notice; excluded accounts are not covered. |
| Rollback loses post-cutover syncs | Freeze writes for the window; keep the verified backup; document the loss boundary. |
