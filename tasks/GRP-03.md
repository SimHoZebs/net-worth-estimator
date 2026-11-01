# GRP-03 — Build group shared transaction feed

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881fdbc86cbeae1d59bcf](https://app.notion.com/p/40bee37bd02881fdbc86cbeae1d59bcf)  
**Depends on:** [GRP-02](./GRP-02.md), [GRP-05](./GRP-05.md), [SOC-02](./SOC-02.md)

**User story:** As a group member, I want a shared transaction feed with trustworthy viewer-specific totals.

### Acceptance criteria

- [ ] Page through indexed owner/posting references and explicit manual grants; validate current membership and policy generation.
- [ ] Filter date/member/category for navigation (not automatic eligibility criteria).
- [ ] Show source member and authorized shared amount.
- [ ] Let recipient save an independently editable linked copy.
- [ ] Leaving or removal revokes access to source originals.
- [ ] Deduplicate postings visible via multiple reasons or matching accounts in feed and totals.
- [ ] Apply friend-specific exclusions per viewer in feed, direct details and counts/totals.
- [ ] Include pending transactions when otherwise authorized.

### Implementation notes and boundaries

Read-only-permission is not a requirement of the shared transaction representation; actual source edits by recipient are deferred.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
