# INT-03 — Detect and extract receipt emails

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028812aba08f0693492b12b](https://app.notion.com/p/40bee37bd028812aba08f0693492b12b)  
**Depends on:** [INT-02](./INT-02.md), [FND-01](./FND-01.md)

**User story:** As a user, I want probable receipt messages extracted for review.

### Acceptance criteria

- [ ] Find likely purchase/refund receipts, exclude ordinary mail and shipping-only updates.
- [ ] Extract merchant, date, amount, currency and available reference.
- [ ] Let users review low-confidence extraction.
- [ ] Deduplicate repeat scans; parser errors must not mutate balances.

### Implementation notes and boundaries

Preserve source provenance and reuse existing receipt evidence concepts.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
