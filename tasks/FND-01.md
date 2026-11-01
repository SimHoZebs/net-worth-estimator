# FND-01 — Extend evidence-backed transaction classification

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881b8abfaca6df9457c2f](https://app.notion.com/p/40bee37bd02881b8abfaca6df9457c2f)  
**Depends on:** None

**User story:** As a user, I want a transaction to hold multiple independently inferred characteristics so recurrence, BNPL, transfer, and receipt evidence do not compete for one category.

### Acceptance criteria

- [ ] Independent classification claims record their source, producer, confidence and supporting evidence.
- [ ] A single transaction may be both BNPL and recurring.
- [ ] Owner corrections override inferred labels without overwriting immutable source facts.
- [ ] Conflicting claims remain visible for review.

### Implementation notes and boundaries

Build on the existing evidence-backed classification backlog and Analysis worker; do not create a parallel classifier.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
