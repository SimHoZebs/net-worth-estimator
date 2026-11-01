# GRP-00 — Specify group transaction sharing and approve architecture

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881968946dd518bb001ba](https://app.notion.com/p/40bee37bd02881968946dd518bb001ba)  
**Depends on:** None

**User story:** As an engineer, I want a ratified group-sharing specification before feature implementation.

### Acceptance criteria

- [ ] Specify per-member opt-in, selected accounts, date interval, manual sharing, audience exclusions, consent preview and automatic late-import behavior.
- [ ] Resolve canonical transaction date source, timezone, interval boundaries, and actual history preview before shipping.
- [ ] Apply ADR-D3 through D10 and correct task-level implementation assumptions.
- [ ] Maintain source-only ownership and separate recipient-owned linked copies.
- [ ] Reuse current transaction response shape and row-level permissions; no per-column sharing grants.
- [ ] Document authorization reason union, exclusions, atomic revocation, concurrency, audit, pagination and testing.
- [ ] Assess current write paths, bulk sync/model replacement and rebuild recovery.
- [ ] Benchmark ADR-D12 alternatives before requiring an event system or broker.
- [ ] Review/accept final spec before coding the auto-sharing feature.

### Implementation notes and boundaries

Approved product decisions exist; not all engineering details are finalized. See [group-sharing decisions](../docs/group-sharing-decisions.md) and ADR RFC. In Notion only the existing-contract checklist is already checked.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
