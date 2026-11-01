# FND-04 — Introduce stable linked-transaction representation

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881709bcaef7e1a4dfd34](https://app.notion.com/p/40bee37bd02881709bcaef7e1a4dfd34)  
**Depends on:** [FND-02](./FND-02.md)

**User story:** As an engineer, I want source and recipient records linked by immutable identities without coupling edits across users.

### Acceptance criteria

- [ ] Use distinct source transaction ID, link ID, source revision, recipient owner and sharing grant identifiers.
- [ ] Recipient-edited private copies survive refresh and source sharing revocation.
- [ ] Do not manufacture a duplicate bank posting.

### Implementation notes and boundaries

This is the source/recipient link model, not a new shared-transaction response DTO. Needed for copying, group feed and splits.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
