# GRP-04 — Implement group sharing selector and explicit consent UI

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881968fa6ed7c6b5eb623](https://app.notion.com/p/40bee37bd02881968fa6ed7c6b5eb623)  
**Depends on:** [GRP-02](./GRP-02.md)

**User story:** As a group member, I want understandable controls for my own per-group sharing and exclusions.

### Acceptance criteria

- [ ] Display own per-group opt-in state (off by default); no admin override.
- [ ] Select owned accounts and one editable date interval, setup-day start/open end defaults.
- [ ] Warn before historical visibility and explain later bank sync may add old-dated matching transactions.
- [ ] Preview current audience and exposure before enabling.
- [ ] Offer manual posting shares independently of automatic sharing.
- [ ] Per transaction+audience, explicit intent is exactly one of default/shared/excluded; cannot simultaneously exclude and explicitly share same target.
- [ ] Exclusions support one friend/group, multiple named audiences or everyone including future audiences, with persistent wildcard for the last case.
- [ ] Owner sees contextual warning when an excluded friend belongs to an otherwise authorized group; never reveal hidden transaction to recipient.
- [ ] Stop-sharing-with-everyone composes normal revocations; independent recipient copies cannot be remotely removed.
- [ ] Do not introduce category rules or transfer special cases.

### Implementation notes and boundaries

Backend is source of truth for authorization; UI warnings must match effective permission decision.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
