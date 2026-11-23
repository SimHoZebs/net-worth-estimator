# Net Worth Estimator — Complete Task Backlog

**Export:** 2026-11-01  |  **Source:** [Notion NWE Project](https://app.notion.com/p/40bee37bd02881f4b55dff6258d68fed)  |  [Master backlog](https://app.notion.com/p/40bee37bd02881dfa97ff0778d1a3468)

**Coverage:** Open records after removing completed work packages, plus one export-only proposed benchmark task (PERF-01). Completed packages were removed on 2026-11-05.

This is a planning export, not an implementation status report. The group-sharing task descriptions below reflect the shipped decisions in [the authorization contract](../docs/authorization.md) rather than only the older master backlog draft.

## Index

### Branding
- [BRD-01 — Research and select replacement product name](./BRD-01.md) (Backlog)
- [BRD-02 — Apply approved product identity across the application](./BRD-02.md) (Backlog)

### Integrations
- [INT-02 — Implement Gmail read-only connection](./INT-02.md) (Backlog)
- [INT-04 — Match email receipt evidence to existing transactions](./INT-04.md) (Backlog)

### Groups & sharing
- [GRP-01 — Add group admission policy: friends-only or invite-link](./GRP-01.md) (Backlog)

### Quality & delivery
- [QA-02 — Add multi-user security and concurrency test coverage](./QA-02.md) (Backlog)

### Architecture validation
- [PERF-01 — Benchmark hash-key, revision-key and event-invalidation strategies](./PERF-01.md) (Proposed / not yet in Notion)

## Full task descriptions

### BRD-01 — Research and select replacement product name

**Status:** Backlog  
**Area:** Branding  
**Source:** [https://app.notion.com/p/40bee37bd02881448121dfdea563fae4](https://app.notion.com/p/40bee37bd02881448121dfdea563fae4)  
**Depends on:** None

**User story:** As a prospective user, I want a memorable and distinct product name.

#### Acceptance criteria

- [ ] Produce at least eight candidates; shortlist three.
- [ ] Check domain availability and obvious trademark conflicts at selection time.
- [ ] Identify an obtainable primary domain and approve the name before changing deployment identity.

#### Implementation notes and boundaries

Nedon.xyz was noted as unavailable; codebase includes NWE/Waypoint terminology. Recheck current availability.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### BRD-02 — Apply approved product identity across the application

**Status:** Backlog  
**Area:** Branding  
**Source:** [https://app.notion.com/p/40bee37bd028818f8515e510f0d25486](https://app.notion.com/p/40bee37bd028818f8515e510f0d25486)  
**Depends on:** [BRD-01](./BRD-01.md)

**User story:** As a maintainer, I want consistent branding across UI, sign-in and deployment.

#### Acceptance criteria

- [ ] Use approved name in all user-facing UI.
- [ ] Migrate OAuth/provider callback URLs and domains without breaking existing sign-in.
- [ ] Provide deliberate redirects for old links.
- [ ] Update build and deployment documentation.

#### Implementation notes and boundaries

Do not rename opaque IDs or historical database keys just for branding.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-02 — Implement Gmail read-only connection

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4](https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4)  
**Depends on:** INT-01 (complete)

**User story:** As a user, I want to authorize read-only Gmail access for receipt discovery.

#### Acceptance criteria

- [ ] Use explicit scoped consent and disconnect.
- [ ] Securely store and refresh tokens server-side.
- [ ] Configurable initial lookback default is 90 days.
- [ ] Subsequent scans are incremental.
- [ ] Isolate user credentials and message contents.

#### Implementation notes and boundaries

Gmail is the first provider; review provider verification/privacy requirements before production.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-04 — Match email receipt evidence to existing transactions

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc](https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc)  
**Depends on:** INT-03 (complete)

**User story:** As a user, I want bank transactions associated with the right email receipts.

#### Acceptance criteria

- [ ] Rank matches by amount, currency, date, merchant and available reference.
- [ ] Ambiguity requires review; support approve/reject/manual association.
- [ ] Persist confirmed associations across sync.
- [ ] Never create a duplicate expense from an email receipt.

#### Implementation notes and boundaries

Use existing private receipt attachments; do not assume bank coverage is complete.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-01 — Add group admission policy: friends-only or invite-link

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3](https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3)  
**Depends on:** SOC-01 (complete)

**User story:** As an administrator, I want friends-only or link-enabled group admission.

#### Acceptance criteria

- [ ] Support friends-only and anyone-with-valid-invite-link modes.
- [ ] Check policy at invite acceptance.
- [ ] Preserve expiry, use-count and revocation constraints.
- [ ] Switching mode does not expel existing members.
- [ ] Test blocked contacts and stale links.

#### Implementation notes and boundaries

Extend existing group/invite implementation rather than create another subsystem.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### QA-02 — Add multi-user security and concurrency test coverage

**Status:** Backlog  
**Area:** Quality & delivery  
**Source:** [https://app.notion.com/p/40bee37bd028812c888feb7be490f386](https://app.notion.com/p/40bee37bd028812c888feb7be490f386)  
**Depends on:** FND-02 (complete), FND-05 (complete)

**User story:** As a maintainer, I want validation of isolation and revocation under concurrent work.

#### Acceptance criteria

- [ ] Cover blocked contacts, group exits, revoked receipts and stale identity assertions.
- [ ] Verify backend-only authorization; read-only mode.
- [ ] Verify manual grant/exclusion invariant, future wildcard and friend-in-group overlap.
- [ ] Cover forged source owner/account/transaction IDs, no selected account, policy disable, date/account reassignments, pending rows, late sync and model replacement.
- [ ] Confirm source access revocation after commit under concurrent read/edit/revoke; no stale index authorization.
- [ ] Test idempotency and concurrent split revisions; no-store shared responses and no cross-group leaks.

#### Implementation notes and boundaries

Do not assume any broad provider cross-user model permission.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### PERF-01 — Benchmark hash-key, revision-key and event-invalidation strategies

**Status:** Proposed / not yet in Notion  
**Area:** Architecture validation  
**Source:** Export-only proposed task (not yet created in Notion)  
**Depends on:** None

**User story:** As an engineer, I need measured evidence before committing to a computation invalidation architecture.

#### Acceptance criteria

- [ ] Benchmark existing full JSON+SHA-256 lookup, a persisted revision-key lookup, event-backed invalidation, and a revision-fast-path/content-hash hybrid using equivalent semantics.
- [ ] Use representative model sizes (100, 1,000, 10,000 transactions), varied accounts/rules/amount resolvers/evaluations, and repeatable workloads.
- [ ] Test warm stable reads, frequent small writes, bank-sync bursts, evaluation-only changes, concurrent requests, cold starts and restarts.
- [ ] Separately measure serialization/hash generation, revision reads/writes, event publication/fanout, cache lookup, full projection/reader/simulator computations.
- [ ] Record p50/p95/p99 latency, CPU, allocations, SQLite lock time, cache hit/miss and total operations; estimate break-even read/write ratios.
- [ ] Measure direct computation as the baseline before slice persistence lands.
- [ ] Validate no stale current results after concurrent writes and no weakened group-sharing revocation under every design.
- [ ] Produce reproducible harness, results, decision write-up; do not select a broker before evidence exists.

#### Implementation notes and boundaries

Proposed export-only task; not a current Notion task. Extends backend/scripts/bench-sim.sh and backend/internal/domain/bench_sim_test.go; see [unified projection](../docs/unified-projection.md).

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---
