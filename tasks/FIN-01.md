# FIN-01 — Detect recurring transaction patterns

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd02881c6b183fe1df4251b14](https://app.notion.com/p/40bee37bd02881c6b183fe1df4251b14)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As a user, I want to find recurring payments and deposits despite changing dates, amounts and merchant descriptions.

### Acceptance criteria

- [ ] Identify weekly, biweekly, monthly, quarterly and annual patterns.
- [ ] Show evidence occurrences and estimated cadence/amount.
- [ ] Handle merchant-name variants and irregular timing.
- [ ] Allow confirmation, rejection and correction.
- [ ] BNPL and recurring findings may coexist.

### Implementation notes and boundaries

Reuse background Analysis and source facts, not a second scheduler.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
