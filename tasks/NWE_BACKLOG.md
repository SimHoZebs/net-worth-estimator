# Net Worth Estimator — Complete Task Backlog

**Export:** 2026-11-01  |  **Source:** [Notion NWE Project](https://app.notion.com/p/40bee37bd02881f4b55dff6258d68fed)  |  [Master backlog](https://app.notion.com/p/40bee37bd02881dfa97ff0778d1a3468)

**Coverage:** 35 existing Notion task records (all marked Backlog) plus one export-only proposed benchmark task (PERF-01).

This is a planning export, not an implementation status report. The group-sharing task descriptions below reflect the later approved decisions in [group-sharing decisions](../docs/group-sharing-decisions.md) rather than only the older master backlog draft.

## Index

### Foundation
- [FND-01 — Extend evidence-backed transaction classification](./FND-01.md) (Backlog)
- [FND-02 — Add cross-user transaction-level authorization](./FND-02.md) (Backlog)
- [FND-03 — Implement shared request and activity inbox](./FND-03.md) (Backlog)
- [FND-04 — Introduce stable linked-transaction representation](./FND-04.md) (Backlog)
- [FND-05 — Add social-operation audit and idempotency contracts](./FND-05.md) (Backlog)

### Branding
- [BRD-01 — Research and select replacement product name](./BRD-01.md) (Backlog)
- [BRD-02 — Apply approved product identity across the application](./BRD-02.md) (Backlog)

### Integrations
- [INT-01 — Create integrations management page and provider contracts](./INT-01.md) (Backlog)
- [INT-02 — Implement Gmail read-only connection](./INT-02.md) (Backlog)
- [INT-03 — Detect and extract receipt emails](./INT-03.md) (Backlog)
- [INT-04 — Match email receipt evidence to existing transactions](./INT-04.md) (Backlog)

### Recurring & financial health
- [FIN-01 — Detect recurring transaction patterns](./FIN-01.md) (Backlog)
- [FIN-02 — Promote a confirmed pattern into a recurring rule](./FIN-02.md) (Backlog)
- [FIN-03 — Define reusable financial-health evaluation metrics](./FIN-03.md) (Backlog)
- [FIN-04 — Build prioritized Financial Health page](./FIN-04.md) (Backlog)
- [FIN-05 — Build data-sufficiency and recommendation explainability layer](./FIN-05.md) (Backlog)

### Money-flow visualization
- [VIS-01 — Build time-bounded financial flow graph](./VIS-01.md) (Backlog)
- [VIS-02 — Build interactive money-flow visualization](./VIS-02.md) (Backlog)
- [VIS-03 — Resolve and verify candidate internal transfers](./VIS-03.md) (Backlog)

### Friends & shared expenses
- [SOC-01 — Implement friend relationships and privacy controls](./SOC-01.md) (Backlog)
- [SOC-02 — Create recipient-owned editable linked copies](./SOC-02.md) (Backlog)
- [SOC-03 — Manually send a transaction with assigned amount](./SOC-03.md) (Backlog)
- [SOC-04A — Implement deterministic split allocation](./SOC-04A.md) (Backlog)
- [SOC-04B — Persist versioned splits and participant allocations](./SOC-04B.md) (Backlog)
- [SOC-04C — Build the split builder and sharing flow](./SOC-04C.md) (Backlog)
- [SOC-05 — Track split settlements separately from balances](./SOC-05.md) (Backlog)

### Groups & sharing
- [GRP-00 — Specify group transaction sharing and approve architecture](./GRP-00.md) (Backlog)
- [GRP-01 — Add group admission policy: friends-only or invite-link](./GRP-01.md) (Backlog)
- [GRP-02 — Implement per-member group transaction-sharing preferences](./GRP-02.md) (Backlog)
- [GRP-03 — Build group shared transaction feed](./GRP-03.md) (Backlog)
- [GRP-04 — Implement group sharing selector and explicit consent UI](./GRP-04.md) (Backlog)
- [GRP-05 — Implement server-side group-share authorization and revocation](./GRP-05.md) (Backlog)

### Quality & delivery
- [QA-01 — Implement reversible, explicit database migrations](./QA-01.md) (Backlog)
- [QA-02 — Add multi-user security and concurrency test coverage](./QA-02.md) (Backlog)
- [QA-03 — Add end-to-end workflows and model integrity regression tests](./QA-03.md) (Backlog)

### Architecture validation
- [PERF-01 — Benchmark hash-key, revision-key and event-invalidation strategies](./PERF-01.md) (Proposed / not yet in Notion)

## Full task descriptions

### FND-01 — Extend evidence-backed transaction classification

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881b8abfaca6df9457c2f](https://app.notion.com/p/40bee37bd02881b8abfaca6df9457c2f)  
**Depends on:** None

**User story:** As a user, I want a transaction to hold multiple independently inferred characteristics so recurrence, BNPL, transfer, and receipt evidence do not compete for one category.

#### Acceptance criteria

- [ ] Independent classification claims record their source, producer, confidence and supporting evidence.
- [ ] A single transaction may be both BNPL and recurring.
- [ ] Owner corrections override inferred labels without overwriting immutable source facts.
- [ ] Conflicting claims remain visible for review.

#### Implementation notes and boundaries

Build on the existing evidence-backed classification backlog and Analysis worker; do not create a parallel classifier.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FND-02 — Add cross-user transaction-level authorization

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881619082da2b05e0cde2](https://app.notion.com/p/40bee37bd02881619082da2b05e0cde2)  
**Depends on:** None

**User story:** As a user, I want to choose who can view specific transactions without exposing my other financial records.

#### Acceptance criteria

- [ ] Authenticate requester; check current group and source-owner membership, owner consent, selected account/date policy where applicable, exclusions, manual grants, and owner-scoped transaction identity.
- [ ] Only the source owner may change their sharing policy or issue explicit grants; a group administrator cannot grant for another member.
- [ ] Deny direct access to unrelated accounts, balances, financial models, secrets, and unrelated receipts.
- [ ] After membership removal, policy disable, account deselection or grant revocation, subsequent reads deny access unless another independent valid grant survives.
- [ ] Reuse existing transaction model and response contract; row-level permission, no column-level ACL or separate read-only cross-user DTO.
- [ ] Recipient-owned linked copies remain independently editable; source-original writes by another member are deferred.
- [ ] Test forged identifiers, stale sessions, and cross-user access isolation.

#### Implementation notes and boundaries

See group-sharing RFC ADR-D3 to D12. Maintain permission checks on the backend; do not treat an index row as final authorization.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FND-03 — Implement shared request and activity inbox

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881dd93dbee8221d04053](https://app.notion.com/p/40bee37bd02881dd93dbee8221d04053)  
**Depends on:** [FND-02](./FND-02.md)

**User story:** As a user, I want received transaction shares and split requests in one place where I can act on them.

#### Acceptance criteria

- [ ] List pending, accepted, declined and canceled requests.
- [ ] Show sender and only an authorized preview.
- [ ] Support accept, decline and dismiss.
- [ ] Mutations are idempotent under retry.
- [ ] Persist unread state.

#### Implementation notes and boundaries

In-app inbox first; email/push notifications are a separate project.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FND-04 — Introduce stable linked-transaction representation

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd02881709bcaef7e1a4dfd34](https://app.notion.com/p/40bee37bd02881709bcaef7e1a4dfd34)  
**Depends on:** [FND-02](./FND-02.md)

**User story:** As an engineer, I want source and recipient records linked by immutable identities without coupling edits across users.

#### Acceptance criteria

- [ ] Use distinct source transaction ID, link ID, source revision, recipient owner and sharing grant identifiers.
- [ ] Recipient-edited private copies survive refresh and source sharing revocation.
- [ ] Do not manufacture a duplicate bank posting.

#### Implementation notes and boundaries

This is the source/recipient link model, not a new shared-transaction response DTO. Needed for copying, group feed and splits.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FND-05 — Add social-operation audit and idempotency contracts

**Status:** Backlog  
**Area:** Foundation  
**Source:** [https://app.notion.com/p/40bee37bd028818e97eccc08dec77811](https://app.notion.com/p/40bee37bd028818e97eccc08dec77811)  
**Depends on:** [FND-02](./FND-02.md), [FND-04](./FND-04.md)

**User story:** As a maintainer, I want cross-user changes traceable and retry-safe.

#### Acceptance criteria

- [ ] Mutating social requests have request IDs or equivalent deduplication.
- [ ] Concurrent revisions and version conflicts fail explicitly.
- [ ] Audit actor, action, target and time.
- [ ] Test retry replay and share/revoke ordering.

#### Implementation notes and boundaries

Avoid logging private transaction evidence in broad audit/event payloads.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### BRD-01 — Research and select replacement product name

**Status:** Backlog  
**Area:** Branding  
**Source:** [https://app.notion.com/p/40bee37bd02881448121dfdea563fae4](https://app.notion.com/p/40bee37bd02881448121dfdea563fae4)  
**Depends on:** None

**User story:** As a prospective user, I want a memorable and distinct product name.

#### Acceptance criteria

- [ ] Produce at least eight candidates; shortlist three.
- [ ] Check domain availability and obvious trademark conflicts at selection time.
- [ ] Identify an obtainable primary domain and approve the name before changing deployment identity.

#### Implementation notes and boundaries

Nedon.xyz was noted as unavailable; codebase includes NWE/Waypoint terminology. Recheck current availability.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### BRD-02 — Apply approved product identity across the application

**Status:** Backlog  
**Area:** Branding  
**Source:** [https://app.notion.com/p/40bee37bd028818f8515e510f0d25486](https://app.notion.com/p/40bee37bd028818f8515e510f0d25486)  
**Depends on:** [BRD-01](./BRD-01.md)

**User story:** As a maintainer, I want consistent branding across UI, sign-in and deployment.

#### Acceptance criteria

- [ ] Use approved name in all user-facing UI.
- [ ] Migrate OAuth/provider callback URLs and domains without breaking existing sign-in.
- [ ] Provide deliberate redirects for old links.
- [ ] Update build and deployment documentation.

#### Implementation notes and boundaries

Do not rename opaque IDs or historical database keys just for branding.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-01 — Create integrations management page and provider contracts

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd02881e28412c1ff22cc2452](https://app.notion.com/p/40bee37bd02881e28412c1ff22cc2452)  
**Depends on:** None

**User story:** As a user, I want to view and control connected integrations and their permissions.

#### Acceptance criteria

- [ ] Show available/connected providers, granted scope, sync status and errors.
- [ ] Support connect, reconnect and disconnect.
- [ ] Keep secrets server-side and isolate each user’s credentials.

#### Implementation notes and boundaries

Build on existing SimpleFIN integration behavior with replaceable adapters.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-02 — Implement Gmail read-only connection

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4](https://app.notion.com/p/40bee37bd028816bb131ee35bbbfefd4)  
**Depends on:** [INT-01](./INT-01.md)

**User story:** As a user, I want to authorize read-only Gmail access for receipt discovery.

#### Acceptance criteria

- [ ] Use explicit scoped consent and disconnect.
- [ ] Securely store and refresh tokens server-side.
- [ ] Configurable initial lookback default is 90 days.
- [ ] Subsequent scans are incremental.
- [ ] Isolate user credentials and message contents.

#### Implementation notes and boundaries

Gmail is the first provider; review provider verification/privacy requirements before production.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-03 — Detect and extract receipt emails

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028812aba08f0693492b12b](https://app.notion.com/p/40bee37bd028812aba08f0693492b12b)  
**Depends on:** [INT-02](./INT-02.md), [FND-01](./FND-01.md)

**User story:** As a user, I want probable receipt messages extracted for review.

#### Acceptance criteria

- [ ] Find likely purchase/refund receipts, exclude ordinary mail and shipping-only updates.
- [ ] Extract merchant, date, amount, currency and available reference.
- [ ] Let users review low-confidence extraction.
- [ ] Deduplicate repeat scans; parser errors must not mutate balances.

#### Implementation notes and boundaries

Preserve source provenance and reuse existing receipt evidence concepts.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### INT-04 — Match email receipt evidence to existing transactions

**Status:** Backlog  
**Area:** Integrations  
**Source:** [https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc](https://app.notion.com/p/40bee37bd028817998e3cbecfc61e6fc)  
**Depends on:** [INT-03](./INT-03.md)

**User story:** As a user, I want bank transactions associated with the right email receipts.

#### Acceptance criteria

- [ ] Rank matches by amount, currency, date, merchant and available reference.
- [ ] Ambiguity requires review; support approve/reject/manual association.
- [ ] Persist confirmed associations across sync.
- [ ] Never create a duplicate expense from an email receipt.

#### Implementation notes and boundaries

Use existing private receipt attachments; do not assume bank coverage is complete.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FIN-01 — Detect recurring transaction patterns

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd02881c6b183fe1df4251b14](https://app.notion.com/p/40bee37bd02881c6b183fe1df4251b14)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As a user, I want to find recurring payments and deposits despite changing dates, amounts and merchant descriptions.

#### Acceptance criteria

- [ ] Identify weekly, biweekly, monthly, quarterly and annual patterns.
- [ ] Show evidence occurrences and estimated cadence/amount.
- [ ] Handle merchant-name variants and irregular timing.
- [ ] Allow confirmation, rejection and correction.
- [ ] BNPL and recurring findings may coexist.

#### Implementation notes and boundaries

Reuse background Analysis and source facts, not a second scheduler.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FIN-02 — Promote a confirmed pattern into a recurring rule

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd028816e8e0fdff2c04e9e69](https://app.notion.com/p/40bee37bd028816e8e0fdff2c04e9e69)  
**Depends on:** [FIN-01](./FIN-01.md)

**User story:** As a user, I want to convert confirmed recurrence into planned cash flow.

#### Acceptance criteria

- [ ] Preview the generated rule and future occurrences.
- [ ] Require explicit approval.
- [ ] Maintain one active generated rule per confirmed source pattern.
- [ ] Never duplicate recorded bank facts as forecast cash movements.
- [ ] Disabling the rule leaves source evidence intact.

#### Implementation notes and boundaries

Observed patterns and forecast definitions are different resources.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FIN-03 — Define reusable financial-health evaluation metrics

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd02881e29de4fd38c9a5a361](https://app.notion.com/p/40bee37bd02881e29de4fd38c9a5a361)  
**Depends on:** None

**User story:** As a user, I want my finances assessed against configurable guidelines.

#### Acceptance criteria

- [ ] Support emergency coverage, cash flow sustainability, debt burden, high-interest debt, savings rate, utilization and spending consistency where data permits.
- [ ] Show input, calculation, threshold, and evidence for each check.
- [ ] Output meeting / at risk / not meeting / insufficient data.
- [ ] Allow adjustable standards; do not present them as universal requirements.

#### Implementation notes and boundaries

Financial-health descriptive checks are distinct from projection-goal evaluations; reuse underlying measurements where applicable.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FIN-04 — Build prioritized Financial Health page

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd02881c7bf62ffd3cc5cdf65](https://app.notion.com/p/40bee37bd02881c7bf62ffd3cc5cdf65)  
**Depends on:** [FIN-03](./FIN-03.md)

**User story:** As a user, I want the highest-risk financial-health issues displayed first.

#### Acceptance criteria

- [ ] Order failing and at-risk checks ahead of passing checks.
- [ ] Display current, target and difference where computable.
- [ ] Drill into records and calculations.
- [ ] Distinguish insufficient data visually.
- [ ] Refresh when relevant inputs change.

#### Implementation notes and boundaries

Do not require one composite financial-health score.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### FIN-05 — Build data-sufficiency and recommendation explainability layer

**Status:** Backlog  
**Area:** Recurring & financial health  
**Source:** [https://app.notion.com/p/40bee37bd02881b8ba4ef380a83017a6](https://app.notion.com/p/40bee37bd02881b8ba4ef380a83017a6)  
**Depends on:** [FIN-03](./FIN-03.md)

**User story:** As an engineer, I want metrics to expose evidence quality and limitations.

#### Acceptance criteria

- [ ] Report sources, freshness and coverage.
- [ ] Represent partial coverage as incomplete, not failure.
- [ ] Link proposed actions to evidence and user-configurable targets.
- [ ] Test missing income, unknown liabilities and stale sync.

#### Implementation notes and boundaries

Never claim complete financial fitness from incomplete records.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### VIS-01 — Build time-bounded financial flow graph

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd028810bb831eee4de3bf8b3](https://app.notion.com/p/40bee37bd028810bb831eee4de3bf8b3)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As a user, I want to trace money entering, moving between and leaving accounts over a selected period.

#### Acceptance criteria

- [ ] Build account/counterparty flow edges from dated transactions.
- [ ] Count an internal transfer once rather than income + expense.
- [ ] Separate actual and projected movements.
- [ ] Expose unmatched or unobserved flow.
- [ ] Reconcile all totals with contributing source records.

#### Implementation notes and boundaries

Preserve transaction direction and indicate incomplete institution coverage.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### VIS-02 — Build interactive money-flow visualization

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd028816aae72cc51eabbe355](https://app.notion.com/p/40bee37bd028816aae72cc51eabbe355)  
**Depends on:** [VIS-01](./VIS-01.md), [VIS-03](./VIS-03.md)

**User story:** As a user, I want an intuitive diagram of money movement.

#### Acceptance criteria

- [ ] Show origins/destinations as nodes and directional edges.
- [ ] Encode flow magnitude with thickness.
- [ ] Re-render with date and account filters.
- [ ] Selecting an edge reveals its source transactions.
- [ ] Aggregate dense data with drilldowns.
- [ ] Provide an accessible text/table alternative.

#### Implementation notes and boundaries

Sankey-like UI is an option; the graph contract should not depend on one renderer. VIS-03 is a native Notion prerequisite in addition to the original story text.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### VIS-03 — Resolve and verify candidate internal transfers

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd0288126afe0d8dfe47949ed](https://app.notion.com/p/40bee37bd0288126afe0d8dfe47949ed)  
**Depends on:** [FND-01](./FND-01.md)

**User story:** As an engineer, I need transfer matching that prevents double-counting.

#### Acceptance criteria

- [ ] Match opposite legs using amounts, dates, direction, and available source IDs.
- [ ] Do not fabricate missing legs.
- [ ] Present ambiguous matches for review.
- [ ] Persist user corrections.
- [ ] Test credit-card payments, repeated imports, and duplicates.

#### Implementation notes and boundaries

Can be developed alongside VIS-01; needed for trustworthy totals.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-01 — Implement friend relationships and privacy controls

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881e88c4dc70e628fa6ea](https://app.notion.com/p/40bee37bd02881e88c4dc70e628fa6ea)  
**Depends on:** None

**User story:** As a user, I want to connect privately with people I know for convenient sharing.

#### Acceptance criteria

- [ ] Support exact-handle/invite friend requests.
- [ ] Accept, decline, remove and block.
- [ ] Provide searchable accepted-friends list.
- [ ] Friendship alone never gives access to financial data.
- [ ] Removed or blocked people cannot receive new friend-only shares.

#### Implementation notes and boundaries

Friendships and group membership are distinct.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-02 — Create recipient-owned editable linked copies

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd028815a8974f99c58ea73d1](https://app.notion.com/p/40bee37bd028815a8974f99c58ea73d1)  
**Depends on:** [FND-04](./FND-04.md)

**User story:** As a recipient, I want an independently editable copy of a shared transaction.

#### Acceptance criteria

- [ ] Allow view-only access or deliberate save as own editable copy.
- [ ] Copy has independent owner and revision.
- [ ] Changes never propagate to sender’s original.
- [ ] Show source changes only while authorized.
- [ ] Recipient copy survives source revocation.
- [ ] Do not claim independent bank verification for copied data.

#### Implementation notes and boundaries

Source-owner edit permission by recipients is explicitly deferred; do not infer it from editable copies.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-03 — Manually send a transaction with assigned amount

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881c2a77ef6b7cb192bb5](https://app.notion.com/p/40bee37bd02881c2a77ef6b7cb192bb5)  
**Depends on:** [SOC-01](./SOC-01.md), [SOC-02](./SOC-02.md), [FND-03](./FND-03.md)

**User story:** As a user, I want to send a friend an assigned share while showing the original total.

#### Acceptance criteria

- [ ] Pick source posting and recipient.
- [ ] Preview original total and assigned portion.
- [ ] Recipient sees permitted source context and allocation.
- [ ] Support accept, decline, view, and save as linked copy.
- [ ] Validate permissions and assigned amount.
- [ ] Retries cannot create duplicate shares.

#### Implementation notes and boundaries

Sending a share does not move money.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-04A — Implement deterministic split allocation

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881b2a262fbfc387b519c](https://app.notion.com/p/40bee37bd02881b2a262fbfc387b519c)  
**Depends on:** None

**User story:** As an engineer, I want a currency-accurate algorithm for split allocation.

#### Acceptance criteria

- [ ] Use integer minor units and proper currency precision.
- [ ] Default to equal shares across initiator and invitees.
- [ ] Give rounding remainder to initiator.
- [ ] Overrides must sum exactly to the total.
- [ ] Reject negative/invalid allocations.
- [ ] Test penny rounding and multiple currencies.

#### Implementation notes and boundaries

Core algorithm independent of the UI.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-04B — Persist versioned splits and participant allocations

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881708973c7565bafca7b](https://app.notion.com/p/40bee37bd02881708973c7565bafca7b)  
**Depends on:** [FND-04](./FND-04.md), [SOC-04A](./SOC-04A.md), [FND-05](./FND-05.md)

**User story:** As an engineer, I want obligations and changes stored independently of financial models.

#### Acceptance criteria

- [ ] Store source, initiator, participant, amount, version and acceptance state.
- [ ] Preserve immutable accepted history.
- [ ] Enforce idempotency and revision concurrency.
- [ ] Authorize each participant.
- [ ] Do not change cash balances on acceptance.

#### Implementation notes and boundaries

Version changes rather than silently altering accepted shares.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-04C — Build the split builder and sharing flow

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd02881e28788caa099fb6702](https://app.notion.com/p/40bee37bd02881e28788caa099fb6702)  
**Depends on:** [SOC-01](./SOC-01.md), [SOC-03](./SOC-03.md), [SOC-04A](./SOC-04A.md), [SOC-04B](./SOC-04B.md)

**User story:** As a user, I want to divide expenses among friends, starting with equal shares.

#### Acceptance criteria

- [ ] Select source posting and participants.
- [ ] Equal allocation default with manual overrides.
- [ ] Immediate total validation.
- [ ] Preview before sending.
- [ ] Show request state per participant.
- [ ] Successful requests appear in the inbox.

#### Implementation notes and boundaries

Compose transaction cards and friend selectors already available.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### SOC-05 — Track split settlements separately from balances

**Status:** Backlog  
**Area:** Friends & shared expenses  
**Source:** [https://app.notion.com/p/40bee37bd028818e8ad6e3a78ec02604](https://app.notion.com/p/40bee37bd028818e8ad6e3a78ec02604)  
**Depends on:** [SOC-04B](./SOC-04B.md)

**User story:** As a user, I want obligations and real payments distinguished.

#### Acceptance criteria

- [ ] Show outstanding, partially settled and settled states.
- [ ] Allow manual settlement and optional link to a real payment.
- [ ] Never synthesize cash movement on share acceptance.
- [ ] Never double count linked payments.
- [ ] Keep settlement history.

#### Implementation notes and boundaries

Future extension: distinguish payer from beneficiary for unevenly paid expenses.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-00 — Specify group transaction sharing and approve architecture

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881968946dd518bb001ba](https://app.notion.com/p/40bee37bd02881968946dd518bb001ba)  
**Depends on:** None

**User story:** As an engineer, I want a ratified group-sharing specification before feature implementation.

#### Acceptance criteria

- [ ] Specify per-member opt-in, selected accounts, date interval, manual sharing, audience exclusions, consent preview and automatic late-import behavior.
- [ ] Resolve canonical transaction date source, timezone, interval boundaries, and actual history preview before shipping.
- [ ] Apply ADR-D3 through D10 and correct task-level implementation assumptions.
- [ ] Maintain source-only ownership and separate recipient-owned linked copies.
- [ ] Reuse current transaction response shape and row-level permissions; no per-column sharing grants.
- [ ] Document authorization reason union, exclusions, atomic revocation, concurrency, audit, pagination and testing.
- [ ] Assess current write paths, bulk sync/model replacement and rebuild recovery.
- [ ] Benchmark ADR-D12 alternatives before requiring an event system or broker.
- [ ] Review/accept final spec before coding the auto-sharing feature.

#### Implementation notes and boundaries

Approved product decisions exist; not all engineering details are finalized. See [group-sharing decisions](../docs/group-sharing-decisions.md) and ADR RFC. In Notion only the existing-contract checklist is already checked.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-01 — Add group admission policy: friends-only or invite-link

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3](https://app.notion.com/p/40bee37bd02881e89007c673c2e1b0a3)  
**Depends on:** [SOC-01](./SOC-01.md)

**User story:** As an administrator, I want friends-only or link-enabled group admission.

#### Acceptance criteria

- [ ] Support friends-only and anyone-with-valid-invite-link modes.
- [ ] Check policy at invite acceptance.
- [ ] Preserve expiry, use-count and revocation constraints.
- [ ] Switching mode does not expel existing members.
- [ ] Test blocked contacts and stale links.

#### Implementation notes and boundaries

Extend existing group/invite implementation rather than create another subsystem.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-02 — Implement per-member group transaction-sharing preferences

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd0288185acb7d7c09c122f88](https://app.notion.com/p/40bee37bd0288185acb7d7c09c122f88)  
**Depends on:** [GRP-00](./GRP-00.md), [FND-02](./FND-02.md)

**User story:** As a group member, I want exclusive control over what my accounts automatically share in each group.

#### Acceptance criteria

- [ ] Automatic sharing is off by default for each member and group; administrators cannot force another member’s consent.
- [ ] Manual posting shares remain usable when automatic sharing is off.
- [ ] Require selecting one or more owner-held accounts; no selected accounts means no automatic eligibility.
- [ ] Eligibility is true if any account currently involved in the posting matches any selected account, including transfers; show a posting once even if multiple accounts match.
- [ ] Configure a single transaction-date interval. Initial start defaults to setup day and remains fixed; optional end defaults open-ended; both editable.
- [ ] A transaction uses its current account associations and current transaction date; edits can add/remove inherited visibility.
- [ ] Pending transactions are handled exactly as posted transactions.
- [ ] Existing and late-imported transactions in the selected date interval qualify; warn before enabling historical disclosure, no secondary sync-date filter or review checkbox.
- [ ] Disable or narrow policy revokes automatic access after commit; preserve independent manual grants and private linked copies.

#### Implementation notes and boundaries

No category filters or transfer-specific exceptions. Exact date field/timezone and void/deleted-posting lifecycle remain to finalize.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-03 — Build group shared transaction feed

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881fdbc86cbeae1d59bcf](https://app.notion.com/p/40bee37bd02881fdbc86cbeae1d59bcf)  
**Depends on:** [GRP-02](./GRP-02.md), [GRP-05](./GRP-05.md), [SOC-02](./SOC-02.md)

**User story:** As a group member, I want a shared transaction feed with trustworthy viewer-specific totals.

#### Acceptance criteria

- [ ] Page through indexed owner/posting references and explicit manual grants; validate current membership and policy generation.
- [ ] Filter date/member/category for navigation (not automatic eligibility criteria).
- [ ] Show source member and authorized shared amount.
- [ ] Let recipient save an independently editable linked copy.
- [ ] Leaving or removal revokes access to source originals.
- [ ] Deduplicate postings visible via multiple reasons or matching accounts in feed and totals.
- [ ] Apply friend-specific exclusions per viewer in feed, direct details and counts/totals.
- [ ] Include pending transactions when otherwise authorized.

#### Implementation notes and boundaries

Read-only-permission is not a requirement of the shared transaction representation; actual source edits by recipient are deferred.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-04 — Implement group sharing selector and explicit consent UI

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881968fa6ed7c6b5eb623](https://app.notion.com/p/40bee37bd02881968fa6ed7c6b5eb623)  
**Depends on:** [GRP-02](./GRP-02.md)

**User story:** As a group member, I want understandable controls for my own per-group sharing and exclusions.

#### Acceptance criteria

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

#### Implementation notes and boundaries

Backend is source of truth for authorization; UI warnings must match effective permission decision.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### GRP-05 — Implement server-side group-share authorization and revocation

**Status:** Backlog  
**Area:** Groups & sharing  
**Source:** [https://app.notion.com/p/40bee37bd02881faa046d278e318e068](https://app.notion.com/p/40bee37bd02881faa046d278e318e068)  
**Depends on:** [GRP-00](./GRP-00.md), [FND-02](./FND-02.md), [GRP-02](./GRP-02.md)

**User story:** As an engineer, I want a single auditable authorization path for shared transaction list and detail views.

#### Acceptance criteria

- [ ] Verify authenticated requester and current requester/source-owner group membership for shared reads.
- [ ] Only source owner may change account/date opt-in policy or manual grants.
- [ ] Validate selected account IDs belong to owner; zero-selected matches none.
- [ ] Use current posting source/destination account intersection, current transaction date and enabled policy to derive inherited access, including pending postings.
- [ ] Maintain write-updated materialized group/owner/posting/policy-generation reference index; do not copy transaction payloads or scan every owner’s postings on reads.
- [ ] Index only one reference per posting/group even if multiple selected accounts match.
- [ ] Version-fence old index rows immediately on policy revocation; bulk/backfill rebuilds may temporarily under-share but cannot over-share.
- [ ] On owner edits, bank sync, pending settlement, account/date changes, deletes and model replacements, atomically update/invalidate index or synchronously fence stale permissions.
- [ ] Combine independent valid access reasons (manual explicit grant plus automatic), then apply scope exclusions and common hard gates.
- [ ] Persist mutually exclusive explicit intent (default/shared/excluded) for each transaction+audience, including friend-through-group and wildcard exclusions.
- [ ] An explicit exclusion must be removed/narrowed before adding contradictory same-audience grant; enforce in one transaction and database constraints.
- [ ] Scope exclusions to friend/group, multiple audiences or all current/future; a friend exclusion denies that person even through group grants while leaving other members authorized.
- [ ] Return the existing transaction representation with account/model access isolated; source-original delegated write remains deferred.
- [ ] Audit policy and grant changes; ensure idempotency, transactional snapshots and no positive auth caching.
- [ ] Test forged IDs, revocation races, stale index, bank sync, duplicates, pending behavior, group membership changes, wildcard exclusions and index performance.

#### Implementation notes and boundaries

Security-critical consistency does not require general event broker. Compare synchronous write hooks vs transaction-bound event dispatch; cache-key-driven forecasts (ADR-D12) are a separate issue.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### QA-01 — Implement reversible, explicit database migrations

**Status:** Backlog  
**Area:** Quality & delivery  
**Source:** [https://app.notion.com/p/40bee37bd02881d098bfd3c05b9a1a50](https://app.notion.com/p/40bee37bd02881d098bfd3c05b9a1a50)  
**Depends on:** None

**User story:** As a maintainer, I want reliable migrations protecting financial records.

#### Acceptance criteria

- [ ] Follow existing explicit/offline setup policy.
- [ ] Document backups and rollback/recovery.
- [ ] Preserve existing users and financial rows.
- [ ] Test upgrades and downgrade recovery.

#### Implementation notes and boundaries

Applies incrementally to schema-changing features.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### QA-02 — Add multi-user security and concurrency test coverage

**Status:** Backlog  
**Area:** Quality & delivery  
**Source:** [https://app.notion.com/p/40bee37bd028812c888feb7be490f386](https://app.notion.com/p/40bee37bd028812c888feb7be490f386)  
**Depends on:** [FND-02](./FND-02.md), [FND-05](./FND-05.md)

**User story:** As a maintainer, I want validation of isolation and revocation under concurrent work.

#### Acceptance criteria

- [ ] Cover blocked contacts, group exits, revoked receipts and stale identity assertions.
- [ ] Verify backend-only authorization; read-only mode.
- [ ] Verify manual grant/exclusion invariant, future wildcard and friend-in-group overlap.
- [ ] Cover forged source owner/account/posting IDs, no selected account, policy disable, date/account reassignments, pending rows, late sync and model replacement.
- [ ] Confirm source access revocation after commit under concurrent read/edit/revoke; no stale index authorization.
- [ ] Test idempotency and concurrent split revisions; no-store shared responses and no cross-group leaks.

#### Implementation notes and boundaries

Do not assume any broad Casdoor cross-user model permission.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### QA-03 — Add end-to-end workflows and model integrity regression tests

**Status:** Backlog  
**Area:** Quality & delivery  
**Source:** [https://app.notion.com/p/40bee37bd02881e19dc5d80643e9a3bf](https://app.notion.com/p/40bee37bd02881e19dc5d80643e9a3bf)  
**Depends on:** [FIN-02](./FIN-02.md), [INT-04](./INT-04.md), [SOC-04C](./SOC-04C.md), [GRP-03](./GRP-03.md), [VIS-02](./VIS-02.md)

**User story:** As a maintainer, I want complete cross-feature workflows tested without distorting money or forecasts.

#### Acceptance criteria

- [ ] Automate receipt review, recurring proposals, split acceptance, group sharing and flow drilldowns.
- [ ] Preserve bank source facts and provenance.
- [ ] Prove simulation outputs change only with relevant model inputs.
- [ ] Document end-to-end release regression gates.

#### Implementation notes and boundaries

Release-level acceptance with story-specific tests added during implementation.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---

### PERF-01 — Benchmark hash-key, revision-key and event-invalidation strategies

**Status:** Proposed / not yet in Notion  
**Area:** Architecture validation  
**Source:** Export-only proposed task (not yet created in Notion)  
**Depends on:** None

**User story:** As an engineer, I need measured evidence before committing to a computation invalidation architecture.

#### Acceptance criteria

- [ ] Benchmark existing full JSON+SHA-256 lookup, a persisted revision-key lookup, event-backed invalidation, and a revision-fast-path/content-hash hybrid using equivalent semantics.
- [ ] Use representative model sizes (100, 1,000, 10,000 postings), varied accounts/rules/amount resolvers/evaluations, and repeatable workloads.
- [ ] Test warm stable reads, frequent small writes, bank-sync bursts, evaluation-only changes, concurrent requests, cold starts and restarts.
- [ ] Separately measure serialization/hash generation, revision reads/writes, event publication/fanout, cache lookup, full projection/reader/simulator computations.
- [ ] Record p50/p95/p99 latency, CPU, allocations, SQLite lock time, cache hit/miss and total operations; estimate break-even read/write ratios.
- [ ] Measure direct computation as the baseline before slice persistence lands.
- [ ] Validate no stale current results after concurrent writes and no weakened group-sharing revocation under every design.
- [ ] Produce reproducible harness, results, decision write-up; do not select a broker before evidence exists.

#### Implementation notes and boundaries

Proposed export-only task; not a current Notion task. Extends backend/scripts/bench-sim.sh and backend/internal/domain/bench_sim_test.go; see [architecture validation](../docs/architecture-validation.md).

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.

---
