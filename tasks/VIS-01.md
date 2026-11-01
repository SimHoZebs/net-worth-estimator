# VIS-01 — Build time-bounded financial flow graph

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd028810bb831eee4de3bf8b3](https://app.notion.com/p/40bee37bd028810bb831eee4de3bf8b3)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As a user, I want to trace money entering, moving between and leaving accounts over a selected period.

### Acceptance criteria

- [ ] Build account/counterparty flow edges from dated transactions.
- [ ] Count an internal transfer once rather than income + expense.
- [ ] Separate actual and projected movements.
- [ ] Expose unmatched or unobserved flow.
- [ ] Reconcile all totals with contributing source records.

### Implementation notes and boundaries

Preserve transaction direction and indicate incomplete institution coverage.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
