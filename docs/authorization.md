# User-scoped authorization

Casdoor authenticates users and hosts the Casbin authorization model. The Go
API calls Casdoor's permission API with private application credentials. It does
not embed a second Casbin engine or evaluate a custom policy language.

## Resources, actions, and roles

A user is the permission boundary. Its model accounts, postings, recurrence rules,
checkpoints, evaluations, presets, pinned results, sync links, and projection
artifacts stay inside that boundary.

| Principal             | Resource                       | Default capabilities                            |
| --------------------- | ------------------------------ | ----------------------------------------------- |
| Provisioned guest user | Its own `users/<opaque-id>`    | `user:read`, `user:project`                     |
| Verified user         | Its own `users/<opaque-id>`    | `user:read`, `user:project`, `user:write`       |
| Any other combination | Another user                   | Denied                                          |

Guest and signed-in users use the same resource and storage shape. Account
creation assigns a Casdoor group. Normal signup receives the members group;
the provisioned guest receives the viewers group. Roles bind those groups to
permitted actions. The owner relationship limits access to the user's own
resource; it does not grant actions. The global server read-only flag still
overrides write permission.

Actions are `user:*` under the Casdoor model (`waypoint/user-access`)
with adapter `user-policy-store`. Permission resources are `users/*`.
There is no sample resource kind or guest-specific permission matcher.

The resource ID derives from the exact OIDC issuer and immutable subject, not
the display name, username, email, or browser input. A new user starts with
an editable blank private scope with no import or administrator approval step.
The user router activates the empty model on first access. Initialization never
replaces existing financial rows. Existing data stays with its
verified owner. There is no first-login claim of existing data.

Casdoor stores the model, roles, and action/resource rules in its SQLite state.
The backend resolves the immutable subject to its current provider username
through Casdoor's bounded user lookup, then submits that provider identity,
resource, action, immutable owner, and immutable actor to the permission API.
The lookup must match the configured organization and exact subject. Deleted,
forbidden, missing, or mismatched users fail closed. Browser fields never supply an owner or a trusted role. Permission errors
fail closed. Positive permission decisions do not have an application cache.

## Data isolation

`NET_WORTH_ESTIMATOR_DB` names one shared application database. `users`
records verified issuer/subject identities. Financial `accounts` are separate
model entities inside each user scope.

Every financial table carries `user_id`. Keys, uniqueness rules, foreign keys,
ordering, bulk replacement, sync, and artifact retention stay inside that user.
The database owns the connection. A scoped store holds one immutable user ID.
No scope-facing operation has an unscoped fallback.

The guest has an ordinary provider identity and an ordinary `users` row in
that same database. `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` selects that provisioned
identity for anonymous requests. It does not assign permissions. Guest grants
can change through the same provider policy mechanism as any user's grants.
Private data never becomes a fallback guest workspace.

All API operations receive the store for the authorized resource. A guessed row
ID in another user's data cannot select another user. Projection artifact identities
and seeded in-flight runs also include the resource ID. Server-level SimpleFIN
credentials remain attached only to the explicitly assigned primary owner.
Other users never inherit that integration.

Published guest data is a snapshot, not a live alias of the owner's data.
`./scripts/dev publish-sample --source-user SOURCE --user GUEST` explicitly
publishes reviewed rows into the provisioned guest user. It
removes private projection history, Bridge links, sync timestamps, and the source
filesystem path from the copy. Later private edits do not change the published guest data.
Replacing that data requires another explicit publication.

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

The rule is the same in dev and production. Casdoor is required. Without it
the server fails closed at startup.

Before an existing authenticated deployment starts the new code:

1. Stop API writes and sync. Back up the application database and Casdoor state.
2. Retain existing issuer and subjects. Provision the guest provider user and
   assign viewer membership. Assign member membership to approved existing users.
3. Install the approved generic group-based model and role permissions.
   Set the application's default signup group to `waypoint/members`.
4. Set `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` to the guest's immutable subject.
   Provision its application rows through `setupdb --issuer ... --subject ...`.
5. Verify guest, member, second-user, denial, revocation, and provider-outage cases.
6. Set `NET_WORTH_ESTIMATOR_OWNER_SUBJECT`. The old
   `NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT` variable no longer exists.

See [the shared database guide](shared-database.md) for backup and rollback.
Runtime startup never merges files or guesses an owner.

No source update automatically publishes private data or changes live Casdoor
permissions. The owner assignment is a one-time data migration, not signup role selection.

## Scope limits

The first resource boundary is the whole user. Transaction-level sharing
(FND-02) grants explicitly named postings to explicit audiences without
widening that boundary: a shared read returns one owner-scoped posting in
the existing transaction shape only, never accounts, balances, models,
secrets, or receipts. A user picker, an IAM management screen, and
cross-user collaboration beyond explicit posting grants remain out of
scope. New action/resource policies belong in Casdoor. New resource
visibility must also pass the API's resource-resolution and
storage-isolation boundary.

Explicit sharing rules:

- Only the source owner may grant, exclude, or revoke their own postings;
  a group administrator cannot grant for another member.
- Group-audience grants authorize only while both requester and source
  owner hold current membership; removal denies immediately.
- Explicit share and exclusion cannot coexist for one posting plus one
  audience; a user exclusion denies that person even through group
  grants, a group exclusion denies its current members, and a wildcard
  exclusion denies all current and future audiences.
- Revocation deletes the grant; later reads deny unless another
  independent valid grant survives. There is no positive auth cache.
- Accepted copies are recipient-owned rows: independently editable, never
  rewritten or erased by revocation. Delegated writes to another
  member's original stay deferred.
- Forged owner, posting, account, and audience IDs fail closed as
  not-found so shared data is not enumerable.

## Linked transactions (FND-04)

A link binds one source-owner posting to one recipient-owned private copy
through immutable identities stored in `sharing_copies`. The copy stays
an ordinary recipient-owned posting; the link is its provenance, not a
shared-transaction response DTO (reads still return the existing
transaction shape only).

Identities on one link (`store.SharingLink`):

- Source transaction ID: `sourceOwnerId` plus `sourcePostingId`.
- Link ID: `link_` plus 64 lowercase hex characters, derived as
  `SHA-256("nwe-sharing-link/v1" || sourceOwnerId || sourcePostingId ||
  recipientUserId)` with `0x00` separators (`store.SharingLinkID`). One
  link per source-plus-recipient triple: repeat accepts return the
  existing recipient row instead of minting duplicates, so the link ID is
  stable across refresh, revocation, re-grant, and retry replays. The
  `link_` prefix keeps links out of the row-ID registry shared by
  accounts, postings, rules, and evaluations. A future scheme change must
  use a new namespace.
- Source revision: opaque hex content hash of the source posting snapshot
  observed at the last authorized copy or refresh
  (`store.SharingSourceRevision`). Compare revisions for staleness; never
  parse them.
- Recipient owner: `recipientUserId` plus `copyPostingId`.
- Sharing-grant identifiers: `grantAudienceType`, `grantAudienceId`, and
  `grantReason` naming the concrete surviving grant (direct user grant,
  or the first group grant in group-ID order where both parties hold
  current membership).

`CopySharedPosting` records the link at accept time and is idempotent per
triple. Copies are always owner-authored with no bank sync key, so
accepting a share never manufactures a duplicate bank posting.

`RefreshSharingLink` re-checks live authorization and source state and
records the outcome on the link row. It never writes the recipient's
copy, so recipient edits survive every outcome. Statuses: `current`
(authorized, revision matches), `source-changed` (authorized, link
records the new revision while the copy keeps its edits),
`unauthorized` (revoked, excluded, or membership ended; exposes no
source content, not even the revision), `source-gone` (defensive: the
source row is missing while the link survives, which `DeletePosting`
never produces itself since it drops links with consent; the copy stays
intact as an ordinary row). Source-row deletion through the API drops the
link with the source consent; recipient-side copy deletion
drops only its own link.

Dependents (SOC-02 recipient copies, SOC-04B splits, FND-05 audit) should
key on `linkId` for idempotency and reference, compare `sourceRevision`
for staleness, and re-check authorization at read time rather than
caching link state.

Casdoor's external permission API evaluates the model and stored policy rows.
Use the model's deny rules or remove the relevant policy/binding to revoke
access. Do not treat application-sign-in approval or UI enable flags as an
additional resource-security boundary.

Resource-scoped query keys prevent accidental cross-user data reuse. Browser
storage remains local to the same browser profile, not an encrypted user vault.
People who share a browser profile can inspect that profile's local data.

Controlling sources:

- [Casdoor permission API](https://casdoor.ai/docs/permission/exposed-casbin-apis/)
- [Permission configuration](https://casdoor.ai/docs/permission/permission-configuration/)
- [Pinned permission model and role policy handling](https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go)
