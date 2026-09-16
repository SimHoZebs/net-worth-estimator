---
title: SimpleFIN sync (Plan B)
description: >
  Managed by kimaki session. NARROW scope approved; implementation complete
  and reviewed (delta fixes applied). Awaiting operator prerequisites:
  card accounts, Bridge link, Access URL + map. Dry-run first.
---

# Plan B — SimpleFIN sync, narrow scope (approved)

## Justification

Manual balances go stale (checking checkpoint was 2026-07-27) and pending
card exposure is unknowable without bank access. Projection needs neither
from SimpleFIN — checkpoints already correct projection state without
emitting movements — so the sync writes only what the UI cannot get
elsewhere. Costs accepted: one stored secret, scheduled network I/O, one
more writer constrained to additive row-level upserts.

## What the sync writes (and nothing else)

1. **Balance checkpoints** for mapped accounts. Checkpoints correct state,
   never duplicate it — no double-count by construction.
2. **Pending card charges** as `enabled=false` `once` postings. Disabled rows
   never execute in projection (`enabled` gates participation), so pending→
   posted overlap cannot double-count; the household card reads them as seed
   input. Snapshot semantics: per-account delete + reinsert each run.

Explicitly never: checking transactions (salary/bills live in the model),
positive card transactions (payments/refunds belong to checking-side transfer
postings), posted charges (projection history stays owner-modeled).
Skipped rows counted by reason, amounts/descriptions never logged.

## Ownership without wire breakage (revised per review)

- V3 migration: `checkpoints`/`postings` gain
  `source TEXT NOT NULL DEFAULT 'model'`; existing rows backfill `'model'`.
  No constraint changes; `UNIQUE(account_id, date)` stays. `source` is
  exposed read-only on `GET` (additive optional field; TS + Zod gain optional
  `source`). `PUT` ignores incoming `source`.
- `replaceDocument` strip-and-merge (kills the stale-PUT hazard structurally):
  incoming `sfin-`-prefixed posting rows are dropped; stored sync rows are
  snapshotted pre-delete and re-merged post-insert, except where an incoming
  owner checkpoint collides on `(account, date)` — the owner row wins and the
  sync row for that key is dropped (next sync skips it; card shows balance
  age). Consequence, documented: sync-owned rows cannot be edited or deleted
  through model PUT; owner override path is adding your own rows.
  `sfin-` id prefix is therefore reserved: user-created `sfin-` postings can
  never persist.
- Pending refresh predicates on `source='simplefin'` AND account AND escaped
  prefix match — never a bare `LIKE`.

## Card-charge shape

Pending card txn (negative amount only) → `once` posting: id
`sfin-pending-<modelAccount>-<txid>` (sanitized), label = truncated
description, `sourceAccountId` = card, no destinations, amount =
`abs(amount)` literal expression, `startDate` = `transacted_at` day or sync
day, `enabled=false`, `priority=6` (sibling-charge tier). Only for model
accounts listed in `NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS`. Prerequisite:
`prime_card`/`ultimate_card` accounts must exist (negative, `-Inf` floor).

## Runner

- `backend/internal/simplefin/`: client (`GET {url}/accounts`,
  90d window, `pending=1`, timeouts, 2 backoffs, redacted errors),
  config (3 env vars, fail closed on unparseable map), map, apply (single
  txn + counts).
- Daily scheduler (random minute, single instance) + `POST /v1/sync/simplefin`
  covered by the same auth middleware as PUT (read-only→403, no/wrong
  token→401). In-memory <20h trigger guard (429). Dry-run env logs planned
  writes, writes nothing — mandatory first live run.
- Secrets: Access URL from env, restart to rotate, never logged (host-only in
  errors), never sent to browsers. Precise guarantee: raw URL/token stay
  server-side; derived balances/descriptions are intentionally public via
  `GET /v1/financial-model`.

## Card auto-seed

`HouseholdCycleCard` seeds Prime/Ultimate/wife inputs from `sfin-pending-*`
rows in the cycle window (posted after the previous 19th), editable, badged
as synced; checking seed from checkpoints already exists, plus a balance-age
+ source line so staleness shows.

## Verification

- Go: V3 backfill + preservation tests; mapper tests on a redacted fixture
  (sign, ids, dates, currency, pending); apply tests (user-row wins, pending
  refresh, posted-absence, rerun idempotency, dry-run); trigger 401/403/200
  matrix; scheduler guard test.
- Client: auto-seed + override + badge tests; `test:run`, `typecheck`.
- Live: dry-run, inspect counts, enable. Operator provides Access URL +
  account map via env; wife's card stays manual.
