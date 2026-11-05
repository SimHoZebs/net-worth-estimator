# INT-04 — Match email receipt evidence to existing transactions

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc](https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc)  
**Depends on:** INT-03 (complete)

**User story:** As a user, I want bank transactions associated with the right email receipts.

### Acceptance criteria

- [ ] Rank matches by amount, currency, date, merchant and available reference.
- [ ] Ambiguity requires review; support approve/reject/manual association.
- [ ] Persist confirmed associations across sync.
- [ ] Never create a duplicate expense from an email receipt.

### Implementation notes and boundaries

Use existing private receipt attachments; do not assume bank coverage is complete.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
