# FND-02 — Add cross-user transaction-level authorization

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881619082da2b05e0cde2](https://app.notion.com/p/40bee37bd02881619082da2b05e0cde2)  
**Depends on:** None

**User story:** As a user, I want to choose who can view specific transactions without exposing my other financial records.

### Acceptance criteria

- [ ] Authenticate requester; check current group and source-owner membership, owner consent, selected account/date policy where applicable, exclusions, manual grants, and owner-scoped transaction identity.
- [ ] Only the source owner may change their sharing policy or issue explicit grants; a group administrator cannot grant for another member.
- [ ] Deny direct access to unrelated accounts, balances, financial models, secrets, and unrelated receipts.
- [ ] After membership removal, policy disable, account deselection or grant revocation, subsequent reads deny access unless another independent valid grant survives.
- [ ] Reuse existing transaction model and response contract; row-level permission, no column-level ACL or separate read-only cross-user DTO.
- [ ] Recipient-owned linked copies remain independently editable; source-original writes by another member are deferred.
- [ ] Test forged identifiers, stale sessions, and cross-user access isolation.

### Implementation notes and boundaries

See group-sharing RFC ADR-D3 to D12. Maintain permission checks on the backend; do not treat an index row as final authorization.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
