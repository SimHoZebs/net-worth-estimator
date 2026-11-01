# SOC-04A — Implement deterministic split allocation

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881b2a262fbfc387b519c](https://app.notion.com/p/40bee37bd02881b2a262fbfc387b519c)  
**Depends on:** None

**User story:** As an engineer, I want a currency-accurate algorithm for split allocation.

### Acceptance criteria

- [ ] Use integer minor units and proper currency precision.
- [ ] Default to equal shares across initiator and invitees.
- [ ] Give rounding remainder to initiator.
- [ ] Overrides must sum exactly to the total.
- [ ] Reject negative/invalid allocations.
- [ ] Test penny rounding and multiple currencies.

### Implementation notes and boundaries

Core algorithm independent of the UI.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
