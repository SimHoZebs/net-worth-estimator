# GRP-02 — Implement per-member group transaction-sharing preferences

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd0288185acb7d7c09c122f88](https://app.notion.com/p/40bee37bd0288185acb7d7c09c122f88)  
**Depends on:** [GRP-00](./GRP-00.md), [FND-02](./FND-02.md)

**User story:** As a group member, I want exclusive control over what my accounts automatically share in each group.

### Acceptance criteria

- [ ] Automatic sharing is off by default for each member and group; administrators cannot force another member’s consent.
- [ ] Manual posting shares remain usable when automatic sharing is off.
- [ ] Require selecting one or more owner-held accounts; no selected accounts means no automatic eligibility.
- [ ] Eligibility is true if any account currently involved in the posting matches any selected account, including transfers; show a posting once even if multiple accounts match.
- [ ] Configure a single transaction-date interval. Initial start defaults to setup day and remains fixed; optional end defaults open-ended; both editable.
- [ ] A transaction uses its current account associations and current transaction date; edits can add/remove inherited visibility.
- [ ] Pending transactions are handled exactly as posted transactions.
- [ ] Existing and late-imported transactions in the selected date interval qualify; warn before enabling historical disclosure, no secondary sync-date filter or review checkbox.
- [ ] Disable or narrow policy revokes automatic access after commit; preserve independent manual grants and private linked copies.

### Implementation notes and boundaries

No category filters or transfer-specific exceptions. Exact date field/timezone and void/deleted-posting lifecycle remain to finalize.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
