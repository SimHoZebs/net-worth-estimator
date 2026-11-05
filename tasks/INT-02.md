# INT-02 — Implement Gmail read-only connection

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4](https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4)  
**Depends on:** INT-01 (complete)

**User story:** As a user, I want to authorize read-only Gmail access for receipt discovery.

### Acceptance criteria

- [ ] Use explicit scoped consent and disconnect.
- [ ] Securely store and refresh tokens server-side.
- [ ] Configurable initial lookback default is 90 days.
- [ ] Subsequent scans are incremental.
- [ ] Isolate user credentials and message contents.

### Implementation notes and boundaries

Gmail is the first provider; review provider verification/privacy requirements before production.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
