# Group transaction sharing — engineering specification (GRP-00)

**Status:** DRAFT — not ratified. Do not implement GRP-02 or GRP-05 until this
spec is reviewed and accepted. Final acceptance is an explicit human review
gate (see §13).

**Sources:** `GROUP_SHARING_DECISIONS.md` product decisions 1–11 (2026-11-01),
`ARCHITECTURE_VALIDATION.md`, `PRODUCT_INTENT.md`, `TECHNICAL_OVERVIEW.md`,
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
- **Policy generation**: a monotonically bumped number per policy, used to
  fence stale index rows on revocation (see §8).

Eligibility of one posting under one policy (automatic reason):

1. Policy enabled.
2. Posting's **current** source account or any current destination account is
   in the selected set. Transfers follow the same rule; no category filters.
   At most one automatic reference per posting+group however many accounts
   match (decision 2).
3. Posting's canonical date (see §2, open Q1/Q2) falls inside the interval,
   inclusive on both ends.
4. Pending and posted postings are treated identically (decision 5).
5. No applicable exclusion survives (see §5).

Moving a posting away from all selected accounts, or re-dating it outside the
window, removes inherited eligibility after commit; moving it back can restore
it. An independent valid manual grant is never silently revoked by those edits
(decision 4).

## 2. Canonical date, timezone, boundaries (OPEN — Q1, Q2)

Current code derives a posting's calendar day as UTC day of `transactionTime`
with `postedTime` fallback (`postingDay` in
`backend/internal/domain/recurrence.go:86`, ordering in
`backend/internal/domain/chrono.go:89`). Both fields are Unix seconds
(`backend/internal/types/model.go:211`).

> **Q1 — canonical date field.** Options: (a) `postingDay` semantics
> (transactionTime, postedTime fallback) **[recommended]** — matches replay,
> position and statement-cycle arithmetic, tolerates legacy rows with zero
> transactionTime; (b) transactionTime only — rejects legacy/malformed rows;
> (c) postedTime only — contradicts decision 3 ("current transaction date,
> not the bank sync date"). Recommendation: (a).

> **Q2 — timezone and interval semantics.** Options: (a) UTC calendar days,
> inclusive both ends, ISO `YYYY-MM-DD` **[recommended]** — matches
> `ParseAsOfCut`/day-close convention (`chrono.go:26`), deterministic across
> viewers, no leak through totals; (b) viewer-local timezone — rejected:
> same posting eligible for one viewer and not another, totals diverge;
> (c) exclusive end — rejected: contradicts "fixed date, editable" product
> language. Recommendation: (a).

## 3. Consent preview and late-import behavior (OPEN — Q3)

- Before enabling history, warn that existing **and later-imported**
  backdated rows in range qualify automatically (decision 3). No secondary
  sync-date filter, no review checkbox.
- Preview must show audience and exposure computed from the current eligible
  set.

> **Q3 — history-preview content.** Options: (a) counts + date range +
> account coverage only, never amounts/payees **[recommended]** — informs
> consent without disclosing payload to shoulder-surfers/logs; (b) full row
> preview — rejected: preview itself becomes a disclosure surface;
> (c) no preview — rejected: contradicts GRP-00/GRP-04 consent requirements.
> Recommendation: (a), with the late-import warning verbatim in the UI copy.

Late-import rule: any row created by bank sync, CSV import, or model
publication whose canonical date falls in range and whose accounts match
qualifies without extra review, exactly like a pre-existing row.

## 4. Void / deleted / disabled lifecycle (OPEN — Q4)

Observed store behavior: `Void` is sync-only (vanished authorization),
`Pending` is bank lifecycle metadata owner writes cannot set, owner deletes
of settled bank rows are permitted
(`backend/internal/types/model.go:215`, `delete_void_bank_test.go`).

> **Q4 — lifecycle eligibility.** Options: (a) share only rows that exist,
> are not void, and are enabled; pending shares like posted; deleted rows
> drop all automatic references; void-marking drops them atomically
> **[recommended]** — follows decisions 5–6 and replay (disabled rows do not
> execute); (b) share disabled rows — rejected: contradicts "current"
> eligibility and leaks model drafts; (c) retain void rows until GC —
> rejected: shares authorizations the bank already withdrew. Recommendation:
> (a). Account deletion or ID reuse must re-validate selected-account
> ownership; dangling references match nothing.

## 5. Manual grants and exclusions

- Automatic reason and manual explicit reason are independent. Effective
  access is the **union** of valid reasons minus exclusions minus hard gates
  (membership, ownership, void/deleted).
- Explicit intent per posting+audience is exactly one state:
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
  posting or its amount in feeds, counts, or totals (decisions 2, 11).

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

## 7. Atomic revocation, concurrency, audit

- Revocation (policy disable/narrow, account deselect, grant revoke,
  exclusion add, membership removal) takes effect at commit: after commit, no
  new unauthorized read may succeed via a stale index row or cache. Index
  maintenance is permission-critical and must be **atomic with the
  source/policy mutation in the same SQLite transaction**, or reads must
  re-validate generation/membership synchronously (fail-closed).
- Generation fencing: every policy mutation bumps `policy_generation`; index
  rows carry the generation they were built under; readers reject rows from
  older generations even if a bulk writer stalls mid-backfill. Rebuilds may
  temporarily **under-share, never over-share** (decision 6).
- Writes are caller-serialized (one server, one SQLite writer,
  `store.go` contract) but backends must still serialize concurrent writes
  safely. No positive auth caching (`docs/authorization.md`); singleflight
  dedup is for computation only and must never serve a stale permission.
- Audit: persist policy creates/updates/disables, manual grant/exclusion
  changes, and generation bumps with actor, timestamp, and before/after
  coverage. Mutations idempotent under retry with transactional snapshots.

## 8. Visibility index schema and reads (OPEN — Q5)

Constraints: no per-posting payload copies (decision 6), no full scan of every
owner's postings on reads (GRP-05), one reference per posting+group.

> **Q5 — index schema/query plan.** Recommended baseline:
> `group_visibility(owner_user_id, posting_id, group_id, policy_generation,
> reason)` with unique `(group_id, posting_id)` and index on
> `(group_id, owner_user_id, posting_id)` for keyset pagination; plus
> `group_share_policy(owner_user_id, group_id, enabled, accounts, start, end,
> policy_generation)` and `share_intent(posting_id, audience, state,
> wildcard)` with mutual-exclusion constraint. Feed reads page the index,
> then re-validate membership + generation + exclusions row-by-row before
> serializing through the existing transaction shape. Alternatives: (b)
> scan-on-read — rejected at scale per GRP-05; (c) payload copies in the
> index — rejected per decision 6. Recommendation: baseline above; exact DDL
> and `EXPLAIN QUERY PLAN` evidence required in GRP-05.

Interrupted backfills resume from the last committed key and remain
under-sharing until complete.

## 9. Write-path assessment

Every path that can change eligibility must maintain or fence the index in
the same commit:

| Write path | Location | Index obligation |
|---|---|---|
| Create/Update/DeletePosting | `store.go:47`, `posting_rows.go` | recompute automatic references for owner's policies in-tx |
| ApplySyncPlan (pending→posted, late inserts, void-marking) | `store.go:93` | same; voids/deletes drop references atomically |
| ConvertPostingToRule / ConvertRuleToPosting | `store.go`, `posting_rows.go:182` | posting side gains/loses references; rules themselves are not shared rows (recommendation — rules expand to occurrences only) |
| Create/Update/DeleteRule | `store.go` | no direct index change (see above) |
| ImportModel / Clear | `import.go`, store contract | full rebuild under new generation (under-share until done) |
| `refreshmodel` operator copy, guest publication | `cmd/refreshmodel`, `shared-database.md` | destination rebuild; never copy source index rows |
| Account update/delete, policy/intent writes (new) | GRP-02/GRP-05 | bump generation; re-derive affected references in-tx |
| MovePosting/MoveRule (position only) | `store.go` | none (identity/date/accounts unchanged) |
| Checkpoint/receipt/evaluation writes | `store.go`, `ReceiptStore` | none (not shared rows) |

## 10. Propagation mechanism (OPEN — Q6, ADR-D12 gate)

> **Q6 — write hooks vs transaction events vs revision keys.**
> Options: (a) synchronous in-transaction index maintenance inside the
> existing `sqliteStore` write methods **[recommended]** — smallest new
> machinery, atomicity falls out of the current one-writer SQLite
> transaction model; (b) transaction-scoped event dispatch to subscribers —
> acceptable only if bounded, in-process, and fail-closed (a failed
> subscriber aborts the tx); (c) persisted revision keys with lazy
> invalidation — acceptable for forecast caches, **not** for the permission
> index unless reads synchronously fence stale generations.
> No Kafka/NATS/broker and no generic event framework without measured
> evidence — that is the PERF-01 gate (ADR-D11/D12). Forecast computation
> may stay lazy; access control may not. Recommendation: (a), with PERF-01
> run before any (b)/(c) production adoption.

## 11. ADR-D3..D10 application (explicit gaps)

- D3 applied: §8 index is derived evidence with read-time safeguards, not a
  durable grant or payload copy.
- D11/D12 applied: §10, no broker; benchmark-first via PERF-01.
- D4–D10: RFC text not available in-repo. Reconstructed working assumptions
  needing RFC confirmation: single-writer SQLite tx gonna govern atomicity;
  Casdoor remains the identity/permission root with no app-side positive
  auth cache; existing transaction JSON shape frozen; group/invite subsystem
  reused not duplicated; recipient copies are independent rows. If the RFC
  contradicts any of these, this spec must be revised before GRP-02/GRP-05.

## 12. Pagination and testing

- Feeds paginate index references with keyset cursors, dedupe before
  slicing, apply viewer exclusions before counts/totals.
- Required matrix: forged user/owner/account IDs; cross-group ID replay;
  friend-through-group overlap; wildcard present+future exclusion;
  mutual-exclusion races; revocation races (read-during-revoke);
  stale-generation reads; bank-sync pending→posted and backdated inserts;
  duplicate multi-account matches counted once; membership leave/remove;
  totals/feed/detail consistency; index `EXPLAIN QUERY PLAN` at 100/1k/10k
  postings; interrupted-backfill resume (under-share, never over-share).

## 13. Acceptance gate

This spec is accepted only after explicit review of Q1–Q6 and §11 gaps.
Acceptance unblocks GRP-02 (preferences) and GRP-05 (authorization), which
stay **blocked** until then. GRP-01/GRP-03/GRP-04 depend on the same answers
and must not bake in contradictory assumptions meanwhile.
