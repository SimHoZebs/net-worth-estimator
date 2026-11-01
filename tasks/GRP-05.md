# GRP-05 — Implement server-side group-share authorization and revocation

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881faa046d278e318e068](https://app.notion.com/p/40bee37bd02881faa046d278e318e068)  
**Depends on:** [GRP-00](./GRP-00.md), [FND-02](./FND-02.md), [GRP-02](./GRP-02.md)

**User story:** As an engineer, I want a single auditable authorization path for shared transaction list and detail views.

### Acceptance criteria

- [ ] Verify authenticated requester and current requester/source-owner group membership for shared reads.
- [ ] Only source owner may change account/date opt-in policy or manual grants.
- [ ] Validate selected account IDs belong to owner; zero-selected matches none.
- [ ] Use current posting source/destination account intersection, current transaction date and enabled policy to derive inherited access, including pending postings.
- [ ] Maintain write-updated materialized group/owner/posting/policy-generation reference index; do not copy transaction payloads or scan every owner’s postings on reads.
- [ ] Index only one reference per posting/group even if multiple selected accounts match.
- [ ] Version-fence old index rows immediately on policy revocation; bulk/backfill rebuilds may temporarily under-share but cannot over-share.
- [ ] On owner edits, bank sync, pending settlement, account/date changes, deletes and model replacements, atomically update/invalidate index or synchronously fence stale permissions.
- [ ] Combine independent valid access reasons (manual explicit grant plus automatic), then apply scope exclusions and common hard gates.
- [ ] Persist mutually exclusive explicit intent (default/shared/excluded) for each transaction+audience, including friend-through-group and wildcard exclusions.
- [ ] An explicit exclusion must be removed/narrowed before adding contradictory same-audience grant; enforce in one transaction and database constraints.
- [ ] Scope exclusions to friend/group, multiple audiences or all current/future; a friend exclusion denies that person even through group grants while leaving other members authorized.
- [ ] Return the existing transaction representation with account/model access isolated; source-original delegated write remains deferred.
- [ ] Audit policy and grant changes; ensure idempotency, transactional snapshots and no positive auth caching.
- [ ] Test forged IDs, revocation races, stale index, bank sync, duplicates, pending behavior, group membership changes, wildcard exclusions and index performance.

### Implementation notes and boundaries

Security-critical consistency does not require general event broker. Compare synchronous write hooks vs transaction-bound event dispatch; cache-key-driven forecasts (ADR-D12) are a separate issue.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
