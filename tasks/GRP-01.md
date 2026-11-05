# GRP-01 — Add group admission policy: friends-only or invite-link

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3](https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3)  
**Depends on:** SOC-01 (complete)

**User story:** As an administrator, I want friends-only or link-enabled group admission.

### Acceptance criteria

- [ ] Support friends-only and anyone-with-valid-invite-link modes.
- [ ] Check policy at invite acceptance.
- [ ] Preserve expiry, use-count and revocation constraints.
- [ ] Switching mode does not expel existing members.
- [ ] Test blocked contacts and stale links.

### Implementation notes and boundaries

Extend existing group/invite implementation rather than create another subsystem.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
