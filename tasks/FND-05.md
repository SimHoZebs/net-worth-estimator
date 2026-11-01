# FND-05 — Add social-operation audit and idempotency contracts

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd028818e97eccc08dec77811](https://app.notion.com/p/40bee37bd028818e97eccc08dec77811)  
**Depends on:** [FND-02](./FND-02.md), [FND-04](./FND-04.md)

**User story:** As a maintainer, I want cross-user changes traceable and retry-safe.

### Acceptance criteria

- [ ] Mutating social requests have request IDs or equivalent deduplication.
- [ ] Concurrent revisions and version conflicts fail explicitly.
- [ ] Audit actor, action, target and time.
- [ ] Test retry replay and share/revoke ordering.

### Implementation notes and boundaries

Avoid logging private transaction evidence in broad audit/event payloads.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
