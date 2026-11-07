# Group transaction sharing — engineering specification (GRP-00)

**Status:** Superseded — GRP-02, GRP-03, and GRP-05 are shipped. This file
retains the pre-ship decision history (Q1–Q6) and must not gate new work.
Current behavior is owned by [authorization](authorization.md). The
acceptance gate in §13 is closed; see `docs/authorization.md` for shipped
automatic-policy, feed, and authorization-path contracts.

**Sources:** `docs/group-sharing-decisions.md` product decisions 1–11 (2026-11-01),
`docs/architecture-validation.md` (now superseded, see below), `PRODUCT_INTENT.md`, `TECHNICAL_OVERVIEW.md`,
`docs/authorization.md`, `docs/shared-database.md`, tasks GRP-00/GRP-02/GRP-05,
FND-02, PERF-01 (export-only proposal).

**Caveat on ADR-D3..D10:** the architecture RFC lives in Notion and is not in
this repository. `git grep ADR-D origin/main` returns nothing. Of the cited
range only D3 (materialized visibility references), D11 (no broker without
evidence) and D12 (hash/revision/event benchmark gate) are recoverable from
the export. §11 records the reconstructed assumptions for D4–D10 explicitly so
reviewers can correct them against the RFC text. Nothing below silently
decides an RFC item.

## 1. Policy model

Per group membership, each member owns one automatic-sharing policy:

- **Enabled flag**, default off, set only by the member. Group admins cannot
  set or force another member's policy (decision 1).
- **Selected accounts**, one or more owner-held account IDs. Zero selected
  means zero automatic eligibility. IDs are validated to belong to the owner
  at write time (GRP-05, FND-02).
- **Single date interval** `[start, end]`, ISO `YYYY-MM-DD` calendar days.
  Start defaults to setup day, persisted as a fixed date (not rolling). End
  defaults blank/open. Both editable before opt-in (decision 3).
- **Policy version number**: bumped on every policy change, used to fence
  stale lookup references on revocation (see §8).

Eligibility of one transaction under one policy (automatic reason):

1. Policy enabled.
2. Transaction's **current** source account or any current destination account is
   in the selected set. Transfers follow the same rule; no category filters.
   At most one automatic reference per transaction+group however many accounts
   match (decision 2).
3. Transaction's canonical date (see §2) falls inside the interval,
   inclusive on both ends.
4. Pending and posted transactions are treated identically (decision 5).
5. No applicable exclusion survives (see §5).

Moving a transaction away from all selected accounts, or re-dating it outside the
window, removes inherited eligibility after commit; moving it back can restore
it. An independent valid manual grant is never silently revoked by those edits
(decision 4).

## 2. Canonical date, timezone, boundaries (DECIDED Q1, Q2)

> **Q1 — canonical date field. DECIDED.** The canonical sharing date is the
> transaction date, used as the single date source with no fallback logic in
> group sharing. Both the transaction date and the posted date must always be
> present on every transaction — if either is optional today, that is a defect.
> Guaranteeing both fields is the job of the bank-data sync reconciliation
> layer, not the sharing derivation. Any missing-date hardening belongs to
> that sync reconciliation work, cross-referenced here, and is out of scope
> for GRP-02/GRP-05, which consume the canonical date as given.

> **Q2 — day counting. DECIDED.** The sharer's own sharing interval governs,
> evaluated on one shared calendar for everyone, with both the start and the
> end dates included. Nobody's viewing range affects anyone else's
> eligibility: sharing is based on the sharer's date range, another user's
> range is irrelevant, and a purchase is inside the range for everyone or for
> no one.

## 3. Consent preview and late-import behavior (DECIDED Q3)

- Before enabling history, warn that existing **and later-imported**
  backdated rows in range qualify automatically (decision 3). No secondary
  sync-date filter, no review checkbox.
- Preview must show audience and exposure computed from the current eligible
  set.

> **Q3 — history-preview content. DECIDED.** The preview shows counts plus
> date range plus account coverage only — never amounts or payees — with the
> late-import warning shown before enabling history. The exact consent-screen
> wording returns for review in the settings-UI work.

Late-import rule: any row created by bank sync, CSV import, or model
publication whose canonical date falls in range and whose accounts match
qualifies without extra review, exactly like a pre-existing row.

## 4. Void / deleted / disabled lifecycle (DECIDED Q4, as shipped)

> **Q4 — lifecycle eligibility. DECIDED, as shipped.** Voided rows retain
> their sharing references while the live gate denies them; deleted rows
> drop theirs. The compensating guarantee is explicit: every shared read
> re-checks at read time that the row still exists and is not void, so a
> retained reference can never serve a withdrawn row. Current behavior is
> owned by [authorization](authorization.md) (`CheckSharedTransactionAccess`
> and `sharing_visibility` index). New transactions follow the existing
> non-void enabled rule; pending transactions are treated like posted ones.
> Account deletion or account-ID reuse must re-validate selected-account
> ownership; dangling references match nothing.

## 5. Manual grants and exclusions

- Automatic reason and manual explicit reason are independent. Effective
  access is the **union** of valid reasons minus exclusions minus hard gates
  (membership, ownership, void/deleted).
- Explicit intent per transaction+audience is exactly one state:
  `default | shared | excluded`. Share and exclusion for the same audience
  cannot coexist; the exclusion must be removed/narrowed first, enforced in
  one database transaction plus constraints (decision 7, GRP-05).
- Exclusion scope: one friend/group, multiple named audiences, or wildcard
  covering current+future groups/friends. Friend-specific exclusion follows
  the person through group membership; other members stay authorized.
- Stop-sharing-with-everyone composes normal revocations and persists a
  wildcard exclusion; no contradictory global booleans (decision 8).
- Owner-only contextual warning when an excluded friend sits in an otherwise
  authorized group. Never reveal hidden rows to recipients.
- Multiple matching accounts and multiple valid reasons never duplicate a
  transaction or its amount in feeds, counts, or totals (decisions 2, 11).

## 6. Ownership, copies, response shape

- Source-only ownership. Recipients may accept and edit their own private
  linked copy; revocation never rewrites or erases existing copies.
  Delegated editing of the sender's original is **deferred**, not approved
  (decision 9).
- Reuse the existing transaction response model. No dedicated cross-user DTO,
  no column-level ACL. Sharing a transaction grants no account/model/balance/
  credential/receipt access beyond that row (decision 10, FND-02).
- Exclusions and current permissions apply uniformly to feeds, direct reads,
  totals, counts and aggregates (decision 11).

## 7. Revocation, concurrency, audit

- Revocation has two halves that hold together. First half, lazy storage
  cleanup: voided rows keep their sharing references until cleanup and
  deleted rows drop theirs (see §4), and policy changes (disable,
  narrowing, account deselection, grant revocation, exclusion added,
  membership removal) bump the policy version number so stale references
  are fenced. Second half,
  fail-closed read-time checks: every shared read re-checks at read time
  that the row still exists, is not void, and the reference belongs to the
  current policy version — so after commit, no new unauthorized read may
  succeed through a retained reference or a cache.
- Rebuilds may temporarily **under-share, never over-share** (decision 6).
- There is one database writer; concurrent writes are still serialized
  safely. Permission decisions are never cached. Computation dedup must never
  serve a stale permission.
- Audit: persist policy creates/updates/disables, manual grant/exclusion
  changes, and version bumps with actor, timestamp, and before/after
  coverage. Mutations idempotent under retry with transactional snapshots.

## 8. Visibility lookup design and reads (DECIDED Q5)

Constraints: no financial data copied into the lookup (decision 6), no full
scan of every owner's purchases on reads, one reference per purchase+group.

> **Q5 — lookup design. DECIDED.** A lightweight reference list with no
> financial data copied. Feed reads page the reference list, then re-check
> membership, policy version, exclusions, and row existence row-by-row
> (see §7) before showing anything through the existing transaction shape.
> Exact table definitions and speed evidence are deferred to the server
> build.

Interrupted backfills resume from the last committed key and remain
under-sharing until complete.

## 9. Write-path assessment

Every path that can change eligibility must maintain or fence the lookup in
the same write:

| Changed data | Sharing-lookup obligation |
|---|---|
| Purchase create/edit/delete | recompute automatic references for the owner's policies in the same write |
| Bank sync (pending-to-posted, late inserts, void marking) | same; voided rows keep references while reads re-check, deleted rows drop theirs (see §4, §7) |
| Purchase-to-repeating-schedule conversion and back | the purchase side gains/loses references; repeating schedules themselves are not shared rows |
| Repeating-schedule create/edit/delete | no direct lookup change (see above) |
| Model import / full reset | full rebuild under a new policy version (under-share until done) |
| Operator copy, guest publication | destination rebuild; never copy source references |
| Account update/delete, policy/consent writes (new) | bump version; re-derive affected references in the same write |
| Reordering rows (position only) | none (identity/date/accounts unchanged) |
| Balance observations / receipt / forecast-setting writes | none (not shared rows) |

## 10. Update method (DECIDED Q6)

> **Q6 — update method. DECIDED.** Sharing permissions are maintained inside
> the same database write that changes the purchase, policy, or consent.
> No separate messaging system without benchmark evidence first. Forecast
> computation may stay lazy; access control may not.

## 11. ADR-D3..D10 application (explicit gaps)

- D3 applied: §8 index is derived evidence with read-time safeguards, not a
  durable grant or payload copy.
- D11/D12 applied: §10, no broker; benchmark-first via PERF-01.
- D4–D10: RFC text not available in-repo. Reconstructed working assumptions
  needing RFC confirmation: single-writer SQLite tx governs atomicity;
  Better Auth is the identity provider and embedded Casbin the permission
  evaluator with no app-side positive auth cache; existing transaction
  JSON shape frozen; group/invite subsystem reused not duplicated;
  recipient copies are independent rows. Current shipped behavior is owned
  by [authorization](authorization.md); this spec is superseded.

## 12. Pagination and testing

- Feeds paginate index references with keyset cursors, dedupe before
  slicing, apply viewer exclusions before counts/totals.
- Required matrix: forged user/owner/account IDs; cross-group ID replay;
  friend-through-group overlap; wildcard present+future exclusion;
  mutual-exclusion races; revocation races (read-during-revoke);
  stale-version reads; bank-sync pending-to-posted and backdated inserts;
  duplicate multi-account matches counted once; membership leave/remove;
  totals/feed/detail consistency; lookup speed evidence at 100/1k/10k
  purchases (deferred to the server build); interrupted-backfill resume
  (under-share, never over-share).

## 13. Acceptance gate (closed)

Q1–Q6 are decided and shipped: GRP-02 (preferences), GRP-03 (group feed),
and GRP-05 (authorization) are implemented. This spec is superseded;
[authorization](authorization.md) owns current behavior. The §11
architecture-gaps note remains as historical context for the RFC
reconstruction and does not block shipped work.
