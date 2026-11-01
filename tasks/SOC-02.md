# SOC-02 — Create recipient-owned editable linked copies

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd028815a8974f99c58ea73d1](https://app.notion.com/p/40bee37bd028815a8974f99c58ea73d1)  
**Depends on:** [FND-04](./FND-04.md)

**User story:** As a recipient, I want an independently editable copy of a shared transaction.

### Acceptance criteria

- [ ] Allow view-only access or deliberate save as own editable copy.
- [ ] Copy has independent owner and revision.
- [ ] Changes never propagate to sender’s original.
- [ ] Show source changes only while authorized.
- [ ] Recipient copy survives source revocation.
- [ ] Do not claim independent bank verification for copied data.

### Implementation notes and boundaries

Source-owner edit permission by recipients is explicitly deferred; do not infer it from editable copies.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
