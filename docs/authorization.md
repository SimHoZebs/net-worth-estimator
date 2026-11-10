# User-scoped authorization

Better Auth authenticates users. The Go API embeds Casbin and owns its policy
database. Casbin makes user-resource policy decisions. API handlers and scoped
storage enforce them. The identity provider holds no financial permissions.

## Resources, actions, and roles

A user is the permission boundary. Its model accounts, transactions, recurrence rules,
checkpoints, evaluations, presets, pinned results, sync links, and projection
projection caches stay inside that boundary.

| Principal             | Resource                       | Default capabilities                            |
| --------------------- | ------------------------------ | ----------------------------------------------- |
| Provisioned guest user | Its own `users/<opaque-id>`    | `user:read`, `user:project`                     |
| Verified user         | Its own `users/<opaque-id>`    | `user:read`, `user:project`, `user:write`       |
| Any other combination | Another user                   | Denied                                          |

Guest and signed-in users use the same resource and storage shape. Account
creation records a persistent Casbin role assignment on first verified access.
Normal signup receives member; explicit setup assigns viewer to the guest. Roles bind identities to
permitted actions. The owner relationship limits access to the user's own
resource; it does not grant actions. The global server read-only flag still
overrides write permission.

Actions are `user:read`, `user:project`, and `user:write` under the embedded
Casbin model. Permission resources are `users/*`.
There is no sample resource kind or guest-specific permission matcher.

The resource ID derives from the exact OIDC issuer and immutable subject, not
the display name, username, email, or browser input. A new user starts with
an editable blank private scope with no import or administrator approval step.
The user router activates the empty model on first access. Initialization never
replaces existing financial rows. Existing data stays with its
verified owner. There is no first-login claim of existing data.

The application stores role assignments and action/resource rules in
`NET_WORTH_ESTIMATOR_AUTHZ_DB`. Subjects use the stable issuer/subject actor key,
never mutable usernames. Each decision loads persisted policy without a positive
decision cache. Explicit denial overrides allows. An explicit none assignment
blocks automatic re-enrollment after revocation. Identity verification rejects
inactive users before authorization. Browser fields never supply an owner or role.
Missing or incompatible policy state stops startup without schema repair.

`authzctl --db PATH --issuer ISSUER --guest GUEST --subject SUBJECT --role ROLE`
changes an assignment to member, viewer, or none. Revocation takes effect on the
next request, including across API processes. Already admitted streams can finish.
The policy database belongs to the application and needs its own safe backup.

Sharing, exclusions, and current social-group membership remain transactional
authorization rules beside the data they protect. This migration preserves their
existing behavior. They do not grant access to another user's full workspace.

## Data isolation

`NET_WORTH_ESTIMATOR_DB` names one shared application database. `users`
records verified issuer/subject identities. Financial `accounts` are separate
model entities inside each user scope.

Every financial table carries `user_id`. Keys, uniqueness rules, foreign keys,
ordering, bulk replacement, sync, and projection caches stay inside that user.
The database owns the connection. A scoped store holds one immutable user ID.
No scope-facing operation has an unscoped fallback.

The guest has an ordinary provider identity and an ordinary `users` row in
that same database. `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` selects that provisioned
identity for anonymous requests. It does not assign permissions. Guest grants
can change through the same Casbin policy mechanism as any user's grants.
Private data never becomes a fallback guest workspace.

All API operations receive the store for the authorized resource. A guessed row
ID in another user's data cannot select another user. Projection state rows
and seeded in-flight runs also include the resource ID. SimpleFIN
credentials stay in each user's own rows. Other users never inherit that integration.

Published guest data is a snapshot, not a live alias of the owner's data.
`./scripts/dev publish-sample --source-user SOURCE --user GUEST` explicitly
publishes reviewed rows into the provisioned guest user. It
removes private projection history, Bridge links, sync timestamps, and the source
filesystem path from the copy. Later private edits do not change the published guest data.
Replacing that data requires another explicit publication.

## Friend relationships

Accepted friendships live in the `friendships` table, keyed by stable
issuer/subject user IDs in both directions. Discovery searches the
caller's own accepted list by display-name substring; names are
non-unique and carry no identity meaning. Unknown users and non-friends
read 404 so friendships are not enumerable.

Friendship is social only. It never grants financial data access: the
friends handler touches no financial table, and every friend read passes
the same own-user permission boundary as all other user routes. A later
share layer must refuse new friend-only shares to removed
recipients through the friendship predicate; that enforcement does not
exist yet, and neither do the request lifecycle writes (send, accept,
decline, remove).

## Browser isolation

`GET /v1/auth/session` returns the selected resource ID and capabilities,
plus a nonempty user subject for both guest and signed-in sessions.
`authenticated` describes sign-in state, not a permission class.
Every financial request asserts that ID in `Waypoint-Resource`. The backend
derives the current resource independently and rejects missing or stale assertions
with 409 and problem code `RESOURCE_CHANGED`. The header name stays
`Waypoint-Resource` for browser and CLI compatibility; the value is now a
user resource. The header does not let a caller
select an arbitrary user. Each save retains its original user ID. A resource-change
error stops the save and triggers session discovery, never a retry under a new
user. Ordinary 409 operation conflicts do not trigger session discovery.

Financial responses include the same resource header. The browser namespaces
server queries by resource and clears active model/projection state before a
resource transition. Unsubmitted fields belong to the mounted form, not a
whole-model browser draft. Cross-tab login and logout cannot silently retarget an old tab's write.
API clients retain their verification scope. A new verification creates new
clients, while old clients reject further calls before network access. Evaluation
pins and financial preferences also reset and reload within the verified scope.
The old-client check stops canceled work, including after the same user returns.
The backend alone validates access. Saves do not require a new session lookup.
One browser session hook owns verification, user transitions, and logout.
Rechecks keep the verified workspace mounted while discovery runs. Same-user
rechecks preserve mounted forms and completed projection results without flicker.
User, API address, or permission changes reset active workspace data only
after the new resource is verified, then the workspace swaps to the new owner.
Failed checks keep the verified workspace mounted behind a retry banner instead
of wiping the UI; cached data stays behind the previous user boundary.
Only an explicit denial or a first load
without a verified session takes over the full screen.

## Deployment and migration

The rule is the same in dev and production. Better Auth and a provisioned Casbin
policy database are required. Missing state fails closed at startup.

Before an existing authenticated deployment starts the new code:

Follow the [one-time identity and policy cutover](../auth/better-auth/one-time/README.md).
Retain the exact issuer and subjects. Import reviewed effective action decisions,
not inferred username ownership. Verify guest, member, second-user, denial,
revocation, and provider-outage cases before release.

See [the shared database guide](shared-database.md) for backup and rollback.
Runtime startup never merges files or guesses an owner.

No source update automatically publishes private data or changes live identity
permissions. The owner assignment is a one-time data migration, not signup role selection.

## Scope limits

The first resource boundary is the whole user. Transaction-level sharing
(FND-02) grants explicitly named transactions to explicit audiences without
widening that boundary: a shared read returns one owner-scoped transaction in
the existing transaction shape only, never accounts, balances, models,
secrets, or receipts. A user picker, an IAM management screen, and
cross-user collaboration beyond explicit transaction grants remain out of
scope. New action/resource policies belong in the application Casbin model. New resource
visibility must also pass the API's resource-resolution and
storage-isolation boundary.

Explicit sharing rules:

- Only the source owner may grant, exclude, or revoke their own transactions;
  a group administrator cannot grant for another member.
- Group-audience grants authorize only while both requester and source
  owner hold current membership; removal denies immediately.
- Explicit share and exclusion cannot coexist for one transaction plus one
  audience; a user exclusion denies that person even through group
  grants, a group exclusion denies its current members, and a wildcard
  exclusion denies all current and future audiences.
- Revocation deletes the grant; later reads deny unless another
  independent valid grant survives. There is no positive auth cache.
- Accepted copies are recipient-owned rows: independently editable, never
  rewritten or erased by revocation. Delegated writes to another
  member's original stay deferred.
- Forged owner, transaction, account, and audience IDs fail closed as
  not-found so shared data is not enumerable.

## Group shared transaction feed (GRP-03)

The per-group feed (`GET /v1/shared/groups/{groupId}/feed`) shows one
member's authorized transactions in one group, each listed once with the
source member's group display name and every path authorizing the viewer
(group names plus direct share). A transaction belongs in the group feed when
the viewer reaches it through the group (manual group grant or automatic
policy) or through a direct share from one of the group's current
members. Discovery reads the indexed references plus the explicit manual
grants; `CheckSharedTransactionAccess` re-validates membership and policy
version on every candidate with no index shortcut, so leaving or removal
revokes source-original access immediately. Friend-specific (user),
group, and wildcard exclusions deny the feed, the detail read, and the
counts alike; pending transactions qualify exactly like posted ones. Date,
member, and movement-direction filters narrow the authorized set for
navigation only and never widen eligibility. Viewer-specific totals (one
count per transaction, the rounded sum of fixed amounts, plus the pending and
calculated-amount rows inside the count but outside the sum) derive from
the same filtered set as the listing, so they always agree. Keyset pages
walk the owner-then-transaction order with an opaque cursor. Saving a copy
reuses the SOC-02 accept flow, yielding an independently editable
recipient row; source edits by recipients stay deferred, and
read-only-permission is not a separate representation.
## Linked transactions (FND-04)

A link binds one source-owner transaction to one recipient-owned private copy
through immutable identities stored in `sharing_copies`. The copy stays
an ordinary recipient-owned transaction; the link is its provenance, not a
shared-transaction response DTO (reads still return the existing
transaction shape only).

Identities on one link (`store.SharingLink`):

- Source transaction ID: `sourceOwnerId` plus `sourceTransactionId`.
- Link ID: `link_` plus 64 lowercase hex characters, derived as
  `SHA-256("nwe-sharing-link/v1" || sourceOwnerId || sourceTransactionId ||
  recipientUserId)` with `0x00` separators (`store.SharingLinkID`). One
  link per source-plus-recipient triple: repeat accepts return the
  existing recipient row instead of minting duplicates, so the link ID is
  stable across refresh, revocation, re-grant, and retry replays. The
  `link_` prefix keeps links out of the row-ID registry shared by
  accounts, transactions, rules, and evaluations. A future scheme change must
  use a new namespace.
- Source revision: opaque hex content hash of the source transaction snapshot
  observed at the last authorized copy or refresh
  (`store.SharingSourceRevision`). Compare revisions for staleness; never
  parse them.
- Recipient owner: `recipientUserId` plus `copyTransactionId`.
- Sharing-grant identifiers: `grantAudienceType`, `grantAudienceId`, and
  `grantReason` naming the concrete surviving grant (direct user grant,
  or the first group grant in group-ID order where both parties hold
  current membership).

`CopySharedTransaction` records the link at accept time and is idempotent per
triple. Copies are always owner-authored with no bank sync key, so
accepting a share never manufactures a duplicate bank transaction.

`RefreshSharingLink` re-checks live authorization and source state and
records the outcome on the link row. It never writes the recipient's
copy, so recipient edits survive every outcome. Statuses: `current`
(authorized, revision matches), `source-changed` (authorized, link
records the new revision while the copy keeps its edits),
`unauthorized` (revoked, excluded, or membership ended; exposes no
source content, not even the revision), `source-gone` (defensive: the
source row is missing while the link survives, which `DeleteTransaction`
never produces itself since it drops links with consent; the copy stays
intact as an ordinary row). Source-row deletion through the API drops the
link with the source consent; recipient-side copy deletion
drops only its own link.

Dependents (SOC-02 recipient copies, SOC-04B splits, consent audit) should
key on `linkId` for idempotency and reference, compare `sourceRevision`
for staleness, and re-check authorization at read time rather than
caching link state.
## Received-share inbox (FND-03)

The inbox is the one place for transaction shares the viewer received.
Entries derive from the ListSharedTransactions primitive on every list; inbox
rows only record the viewer's own decision, read, and dismissed state and
never authorize. Every preview re-checks current membership, exclusion,
and revocation state, and revoked shares surface as canceled without
transaction content. Sighting rows are not an auth cache: a row only
records that a share was visible at one time so a later loss of
authorization reads as canceled.

Recipient rules:

- Accepting saves one personal editable copy and records acceptance.
  Retries never mint a second copy: an already-recorded acceptance
  returns its item, and a copy saved through the shared-copies path
  first is adopted.
- Declining a directly shared transaction also withdraws the viewer's own
  grant, so they leave the sender's sharing list; there is deliberately
  no notification beyond the updated list. Declining a group-audience
  share keeps the owner's grant and stays viewer-local.
- A recorded acceptance never reverts; acceptance may follow a decline
  while the share stays authorized.
- A fresh grant after a decline re-opens the share as pending unread;
  standing grants never reset a recorded decline.
- Concurrent accepts converge on one copy: the loser removes its orphan.
  Sequential retries never mint twice.
- Dismissing hides an item without changing its decision; unhiding
  restores it.
- Unread state changes only through explicit mark-read/mark-unread.
  Listing, viewing, and deciding never clear it.
- Clearing the viewer's model resets their inbox state; currently shared
  transactions re-sight as new on the next list.

Split-request producer contract (SOC-03 assigned shares, SOC-04C split
requests): producers persist their own request rows — split persistence
itself belongs to SOC-04B — and surface them through the same item
envelope with kind `split-request`, carrying sender identity, one of the
`pending`, `accepted`, `declined`, or `canceled` statuses, and an
authorized-only preview. Inbox mutations stay idempotent under retry, and
creation endpoints must take idempotency keys so retries cannot create
duplicate requests.

SOC-02 HTTP contract (recipient scope, existing shapes only):

- `POST /v1/shared/copies` accepts `{owner, transactionId, requestId}` and
  returns the recipient-owned copy as `{"transaction": <transaction>}`. The copy is an
  ordinary owner-authored row (`source: "user"`, never pending or void,
  no bank sync key); repeat accepts return the existing row with its
  edits intact. Recipient edits to the copy never reach the source, and
  there is still no path that edits another member's original (405).
- `GET /v1/shared/copies/{copyId}/link` returns `{"link": <SharingLink>}`
  with the deterministic link ID, source and recipient identities,
  observed source revision, and authorizing grant. It is the recipient's
  own provenance, so it stays readable after revocation.
- `POST /v1/shared/copies/{copyId}/refresh` returns the
  `SharingLinkRefresh` value (`link`, `status`, and `currentSourceRevision`
  only while authorized). Statuses are `current`, `source-changed`,
  `unauthorized`, and `source-gone`. Refresh records on the link row and
  obeys the read-only kill switch; it never writes the copy. It accepts
  an optional `requestId` body for idempotent retry and mints a server
  key when none travels; each committed refresh appends one
  `link-refreshed` audit row carrying the link, the outcome status, and
  the key.

## Social-operation audit and idempotency

Every mutating consent, accept, and refresh request carries a
client-generated UUID request ID (`requestId` over HTTP on the grant,
exclusion, copy, and refresh routes; refresh mints a server key when
none travels). The store records one outcome row per
(actor, request ID): a retry replays the recorded outcome without
re-executing, a key reused for a different action or target fails with
`ErrSharingConflict` (HTTP 409, no session-discovery code), and failed
attempts never consume the key. A source revision landing mid-accept
fails explicitly and rolls the copy back; concurrent accepts resolve to
the winner's copy. Committed mutations append one `sharing_audit` row
each — consent kinds (`grant`, `revoke`, `exclude`, `unexclude`) with
the request key in the detail payload, `copy-accepted` with the link
and key, `link-refreshed` with the link, status, and key — carrying
actor, action, target identities, and time only, never transaction
evidence. Replays and heals append none. The source owner reads one
transaction's trace at `GET /v1/shared/audit?transactionId=<uuid>` as
`{"audit": [...]}` in sequence order; there is no audience-side read.
Model replacement and scope clears drop the keys and user-touching
audit rows the cleared user executed or owns, so a cleared scope
restarts with an empty trace.
## Automatic sharing policies

Per-group automatic preferences (GRP-02) let each member opt their own
transactions into group visibility without per-transaction grants. Absence of a
preference row means off; administrators cannot set another member's
preference. Enabling requires one or more owner-held accounts; an empty
selection matches nothing. One transaction-date interval governs, with the
start fixed at the setup day by default and an open end; both stay
editable. Pending transactions qualify exactly like posted ones; void and
deleted rows never authorize. Eligibility always derives from the
transaction's current accounts and current transaction date, so owner edits,
bank sync, and late imports reshape visibility without touching the
preference. Every committed preference change bumps its version, and
disabling or narrowing revokes automatic access on commit with no cache.
Manual grants, exclusions, independent copies, and the union-minus-
exclusions composition keep their FND-02 behavior alongside the
`automatic-group` reason. Preference reads and the counts-only exposure
preview stay owner-scoped; other members never read the preference rows.

Policy contract for the server authorization path (GRP-05): `store.SharingPolicy`
rows plus `store.PolicyCoversTransaction` stay the single eligibility rule.
`CheckSharedTransactionAccess` alone decides every shared list and detail
read from live rows on each call — current membership both sides,
owner consent (manual grant union automatic policy), exclusions, void
and deleted state, and revocation — with no positive auth cache.
`ListSharedTransactions` discovers automatic candidates from the
write-maintained `sharing_visibility` reference index (one row per
transaction plus group at the current policy version, no payload copied, one
listing per transaction however many accounts, groups, or reasons match) and
re-authorizes each through `CheckSharedTransactionAccess`, so a stale or
missing reference under-shares a list but never over-shares a read.
Every write that changes transactions, policies, accounts, memberships, or
consent maintains or fences the index in the same transaction: inserts,
owner edits, bank-sync conversions and late inserts, policy sets and
account-strip narrowing (with version bumps), membership leave and
removal, group deletion, and model replacement; voided rows retain their
reference while the live gate denies them, and deleted rows drop theirs.
Policy, grant, and exclusion mutations append one `sharing_audit` row
with actor, timestamp, and before/after coverage (policies) or the
request key (consent) in the same
transaction; keyed consent retries and heals audit nothing (policy
writes carry no request key and audit every PUT). Operator recovery uses
`RebuildSharingIndex`, which re-derives one owner's slice from live rows
in one transaction for current memberships only and never over-shares. Consumers (feed,
consent UI): list results order by owner then transaction with the existing
transaction shape; keyset pagination over the index and any audit read
path belong to the consumer, not this path. Statement caution: the SQLite
driver binds arguments to placeholders sequentially by index and ignores
`sql.Named` wrapping, so the auto-appended `:user_id` argument binds to
whatever placeholder stands last — keep `:named` placeholders textually
last or values silently misbind with no error.

## Versioned splits (SOC-04B)

A split divides one shared transaction across authorized participants as
an obligation record stored independently of financial models
(`splits` plus `split_allocations`, `store.Split`). Amounts are integer
minor units computed by `domain.AllocateSplit` (SOC-04A); the store
persists the computed shares verbatim and never invents them. Every
revision appends a version row with status `proposed` and reset
acceptances: accepted shares only change through an explicit new
version, never by silent edit. Acceptance is per participant; the version
turns `accepted` when every participant has accepted. Split writes never
touch transactions, checkpoints, accounts, or balances, so acceptance moves
no money.

Split authorization rules:

- Only the initiator may create or revise their split; anyone else fails
  closed (`ErrGroupForbidden`).
- Every participant (initiator included) must hold current
  shared-transaction access to the source at creation and at each revision;
  a participant without access fails the whole write as not-found, so
  authorization never leaks who can see the source.
- Reads are participant-scoped: the initiator or a participant of the
  latest version may read the split and its version history; anyone else
  receives not-found, so membership is not enumerable. Reads perform no
  live source check: the split survives source edits, revocation, and
  source deletion like accepted-copy provenance.
- Revisions cannot move a split to another transaction, and participants
  removed by a revision lose read access to the split.
- Every mutation carries a client UUID request ID: retries replay the
  recorded split, key reuse across split actions fails as a conflict,
  and stale expected versions fail explicitly instead of forking
  history. Split audit events (`split-created`, `split-updated`,
  `split-accepted`) reuse the consent `sharing_audit` table with the
  split link, resulting status, and request key in the detail payload,
  and stay owner-scoped through `ListSharingAudit`, so there is no
  audience-side split audit read.
- Model replacement and scope clears drop splits touching the cleared
  user, so a split never attaches to an unrelated new row.

Embedded Go Casbin evaluates the model and stored policy rows.
Use explicit permissions or `authzctl --role none` to revoke
access. Do not treat application-sign-in approval or UI enable flags as an
additional resource-security boundary.

Resource-scoped query keys prevent accidental cross-user data reuse. Browser
storage remains local to the same browser profile, not an encrypted user vault.
People who share a browser profile can inspect that profile's local data.

## Development admin observation branch

`NET_WORTH_ESTIMATOR_ADMIN_SUBJECT` names one verified Better Auth subject allowed
to observe and act on every user resource. Unset (the default) disables the
branch; the boundary then behaves as if the code were absent. Never set the
variable in production without completing the SOP at the end of this section.

The branch exists so a debugging agent can reproduce what the user sees. It is
not a backdoor credential: requests still authenticate through Better Auth
(browser session or device flow) as the dedicated admin account, and every
request carries the usual `Waypoint-Resource: users/<64hex>` header.

Semantics:

- The admin account is an ordinary Better Auth user. The branch needs no extra
  Casbin grant for that account; the backend env var names which verified subject the
  branch applies to.
- When the verified principal matches the configured subject, the boundary
  looks up the target resource in `users` (never provisions it), asks
  embedded Casbin for `user:read`, `user:project`, and `user:write`
  on the target resource as the target's identity, and grants exactly the
  actions the target's own grants allow. A member target yields all three
  actions; a viewer guest target yields read and project only.
- Provider login disablement and policy revocation are separate operations.
  To exclude a target from this branch too, persist a none assignment in Casbin.
- The synthesized principal is the target, so every handler serves the
  target's own partition; resource headers, model ownership, and SimpleFIN
  credential attachment all follow the target.
- Every impersonated request logs one structured line:
  `admin impersonated scope` with `request_id`, `method`, `path`,
  `admin_actor` (ActorKey hash of the admin subject) and `target_resource`.
  Rejections log `admin impersonation rejected` with the reason.
- Read-only mode, the resource header check, and per-route action mapping are
  unchanged. The guest path is unchanged.

Tooling for agents, for the two access shapes:

- HTTP as the admin: complete the device flow as the dedicated admin account,
  then call any `/v1` route with `Authorization: Bearer <token>` and the
  target `Waypoint-Resource` header, e.g.
  `curl -s -H "Authorization: Bearer $NWE_ADMIN_TOKEN" -H "Waypoint-Resource: users/<64hex>" "$API/v1/status"`.
- Raw data: the read-only CLIs in `backend/cmd` (for example `syncaudit`)
  read a database file directly and work unchanged.

Structured logging (the debugging surface this shares with the branch): the
server emits single-line JSON to stdout via slog. One line per request:
`request_id`, `method`, `path` (no query string), `status`, `dur_ms`, and the
`Waypoint-Resource` response header as `user_resource` when set. Boundary
denials log the reason (`unauthenticated`, `missing_action`,
`resource assertion mismatch`). Boot failures, sync summaries, and unplanned
panics log structured lines as well. Secrets never enter these lines. Browser
unhandled errors arrive at `POST /v1/client-errors` (user:read, so guests can
report) and log `browser error` with `message`, `stack` (bounded), `source`,
`path`, and `request_id`. sendBeacon cannot carry the Waypoint-Resource
header, so that one route is exempt from the resource assertion (it keeps
every other boundary check); the beacon lines therefore carry no
`user_resource`, and identity for a report is not established. Correlation:
the `browser error` line and the request log line for the same beacon share
one `request_id`. Logs live only in the container stdout; keep them out of
files with private data on shared hosts.

Production enablement SOP (do not skip):

1. Decide with the operator; this is a product decision, not a config tweak.
2. Create the dedicated admin account in Better Auth; complete device flow
   as it from a trusted machine; confirm it resolves to the expected verified
   subject (issue a `/v1/status` call with and without the target header).
3. Patch the Northflank service env to set `NET_WORTH_ESTIMATOR_ADMIN_SUBJECT`.
   Northflank env PATCH replaces all variables, so re-supply the complete set
   from the recorded variable list; never paste secrets into shell history.
4. Verify `admin impersonated scope` lines appear on a targeted request and
   that a non-admin caller cannot impersonate (expect `resource assertion
   mismatch` / fall-through behavior). Confirm `/readyz` and a real user
   journey still work.
5. Record removal: to disable, remove the variable and redeploy; delete the
   admin account or revoke its sessions in Better Auth; confirm with a non-admin
   probe.

Literal every-action-on-every-resource semantics (including writes with a
viewer guest target) is not available today. The application Casbin matcher
confines each evaluated identity to its own resource. Any broader model change
needs its own reviewed release and explicit policy conversion with a backup.
Then re-verify guest and
member isolation end to end. The branch above never borrows that guarantee;
it only ever yields what the target itself holds.

Removing the branch entirely: unset `NET_WORTH_ESTIMATOR_ADMIN_SUBJECT`,
redeploy, optionally delete the admin account; the code path is inert without
the variable. No data migration is involved.

Controlling sources:

- [Casbin authorization model](https://casbin.org/docs/model-storage/)
- The embedded model and persisted policy implementation in `backend/internal/authorization/`.
