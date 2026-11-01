# VIS-03 — Resolve and verify candidate internal transfers

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd0288126afe0d8dfe47949ed](https://app.notion.com/p/40bee37bd0288126afe0d8dfe47949ed)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As an engineer, I need transfer matching that prevents double-counting.

### Acceptance criteria

- [ ] Match opposite legs using amounts, dates, direction, and available source IDs.
- [ ] Do not fabricate missing legs.
- [ ] Present ambiguous matches for review.
- [ ] Persist user corrections.
- [ ] Test credit-card payments, repeated imports, and duplicates.

### Implementation notes and boundaries

Can be developed alongside VIS-01; needed for trustworthy totals.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
