# SOC-04B — Persist versioned splits and participant allocations

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881708973c7565bafca7b](https://app.notion.com/p/40bee37bd02881708973c7565bafca7b)  
**Depends on:** [FND-04](./FND-04.md), [SOC-04A](./SOC-04A.md), [FND-05](./FND-05.md)

**User story:** As an engineer, I want obligations and changes stored independently of financial models.

### Acceptance criteria

- [ ] Store source, initiator, participant, amount, version and acceptance state.
- [ ] Preserve immutable accepted history.
- [ ] Enforce idempotency and revision concurrency.
- [ ] Authorize each participant.
- [ ] Do not change cash balances on acceptance.

### Implementation notes and boundaries

Version changes rather than silently altering accepted shares.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
