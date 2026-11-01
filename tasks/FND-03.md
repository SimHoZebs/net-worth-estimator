# FND-03 — Implement shared request and activity inbox

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881dd93dbee8221d04053](https://app.notion.com/p/40bee37bd02881dd93dbee8221d04053)  
**Depends on:** [FND-02](./FND-02.md)

**User story:** As a user, I want received transaction shares and split requests in one place where I can act on them.

### Acceptance criteria

- [ ] List pending, accepted, declined and canceled requests.
- [ ] Show sender and only an authorized preview.
- [ ] Support accept, decline and dismiss.
- [ ] Mutations are idempotent under retry.
- [ ] Persist unread state.

### Implementation notes and boundaries

In-app inbox first; email/push notifications are a separate project.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
