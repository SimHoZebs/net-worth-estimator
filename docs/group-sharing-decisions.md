# Group transaction sharing — ratified product requirements and open engineering decisions

**Status:** Superseded. Q1–Q6 are decided in
[`docs/group-sharing-spec.md`](group-sharing-spec.md) and shipped; current
behavior is owned by [authorization](authorization.md). Retained as the
pre-decision product record.

**Source of truth:** [Notion product specification / architecture RFC](https://app.notion.com/p/40bee37bd02881639c15e9cf5076577e).  **Date:** 2026-11-01.

## Approved / decided behavior

1. **Member autonomy.** Each member chooses their own per-group automatic sharing policy; initially disabled, never set by group admins. Manual transaction sharing remains independent.
2. **Selected accounts.** Owner must choose account(s); zero selected accounts means zero automatic shares. The transaction qualifies when **at least one currently associated source or destination account** belongs to the chosen set. Treat transfers like other transactions; no category-based auto rules. A transaction appears at most once.
3. **Single date window.** Start defaults to setup day, persisted as a fixed date, not rolling. End defaults blank/open. Both editable before opt-in. Date eligibility uses the **current transaction date**, not the bank sync date. Backdated imports in range qualify without extra review; warn before enabling history.
4. **Derived account/date permission.** Moving a transaction away from all selected accounts or dating it outside the configured window automatically removes inherited transaction-read eligibility after commit. Moving it back can restore eligibility. An independent valid manual transaction grant is not silently revoked by those changes.
5. **Pending transactions.** Pending is not a sharing filter. Pending and posted are treated the same for account/date eligibility. Normal sync, merger and status transitions must not duplicate feed entries.
6. **Materialized group visibility references.** Approved ADR-D3: maintain lightweight index entries during writes, keyed to current policy generation, with read-time membership/policy safeguards. This is derived evidence, not a durable per-transaction grant nor a copy of private financial records. Revocation takes effect immediately; historical rebuild may temporarily under-share but never over-share.
7. **Manual grants and exclusions.** Automatic reason and manual explicit reason remain independent. Explicit intent for a given transaction+target is **one state**: default, explicitly shared, or excluded. Explicit share and exclusion cannot coexist for the same audience. Remove/narrow exclusion before explicit share. Audience exclusion may be one friend/group, multiple friends/groups, or a wildcard covering current+future groups/friends. Friend-specific exclusion follows a person through group membership; other group members may still see the record. Show contextual warning to owner only.
8. **Stop-sharing action.** Stop-sharing-with-everyone composes normal revocations. Selecting all current+future audiences persists wildcard exclusion; no contradictory global deny/allow booleans.
9. **User-owned linked copies.** Recipients can accept and edit their own private copy. Existing copies aren't remotely erased or rewritten by revocation; editing the sender's original as a delegated recipient is **deferred**.
10. **Row-level permission and original response type.** Sharing a transaction doesn't grant unrelated owner account/model/balance/credential access. Reuse existing transaction response model; don't create a dedicated read-only cross-user DTO or column-level ACL.
11. **Viewer-specific effective totals.** Exclusions and current permissions must apply to group feeds, direct reads, totals, counts, and aggregates; no hidden details leak via a different endpoint.

## Architecture evaluation (NOT final selection)

- **ADR-D11:** Transaction change events or subscriber hooks were investigated for multiple derived consumers. No Kafka/NATS/broker selection, and no mandate to construct a generic event framework. Do not reinvent a durable messaging service.
- **ADR-D12:** Existing projections and evaluations use input-identity cache keys and request-driven computation; this is a promising baseline, not a measured performance winner. Separate base path, reader evaluations and simulator evaluations; reuse one simulation where appropriate. Background Analysis currently has a separate evidence revision worker.
- **Validation required:** Benchmark full-model hashing, persisted revisions, event-driven invalidation and hybrid revision+hash fast path. See `docs/architecture-validation.md` (superseded; unified slice persistence is shipped) and export-only proposed `PERF-01`.
- **Security exception:** Visibility-index revocation is permission-critical and must be atomic with source/policy mutation or guaranteed by a current fail-closed permission check. Forecast computation may remain lazy; access control may not.

## Open items (resolved; see spec for decisions)

The items below are resolved by Q1–Q6 in
[`docs/group-sharing-spec.md`](group-sharing-spec.md) and by shipped
contracts in [authorization](authorization.md). They are retained here as
the pre-decision open-item list so the log stays in one place.

- Canonical date, timezone, and interval semantics — DECIDED Q1–Q2 in
  `docs/group-sharing-spec.md`.
- History preview content and warnings — DECIDED Q3 in
  `docs/group-sharing-spec.md`.
- Voided/deleted lifecycle and account-reference integrity — DECIDED Q4 in
  `docs/group-sharing-spec.md` (void retains, deleted drops; reads re-check).
- Indexed-read schema, sync coverage, backfill handling — DECIDED Q5 in
  `docs/group-sharing-spec.md`; shipped as `sharing_visibility` with
  `CheckSharedTransactionAccess` per `docs/authorization.md`.
- Write-hook versus broker choice — DECIDED Q6 in
  `docs/group-sharing-spec.md` (same-write maintenance, no broker).
- Delegated editing of someone else's *original* transaction is deferred,
  not approved for current implementation.

## Acceptance and security checks

- Revocation after account/date/policy changes denies new unauthorized reads after commit; no stale index entry or frontend cache may grant access.
- Cross-group IDs, forged user/owner/account IDs, friend-specific group overlap, future wildcard exclusions and mutual-exclusion constraints tested.
- Multiple selected account matches and multiple access reasons never duplicate a transaction or its amount.
- Pending-to-posted sync and later-imported history preserve proper identity, eligibility and audit.

[Backlog](../tasks/NWE_BACKLOG.md) | [Task GRP-00](../tasks/GRP-00.md) | [Task GRP-05](../tasks/GRP-05.md)
