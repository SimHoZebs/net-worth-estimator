# Plan-scoped authorization

Casdoor authenticates accounts and hosts the Casbin authorization model. The Go
API calls Casdoor's permission API with private application credentials. It does
not embed a second Casbin engine or evaluate a custom policy language.

## Resources, actions, and roles

A plan is the permission boundary. Its accounts, postings, recurrence rules,
checkpoints, evaluations, presets, pinned results, sync links, and projection
artifacts stay inside that boundary.

| Principal             | Resource                    | Default capabilities                      |
| --------------------- | --------------------------- | ----------------------------------------- |
| Guest                 | `plans/sample`              | `plan:read`, `plan:project`               |
| Verified account      | Its own `plans/<opaque-id>` | `plan:read`, `plan:project`, `plan:write` |
| Any other combination | Another account's plan      | Denied                                    |

Signed-in accounts use their private plan, not the sample. Signup does not ask
for a role. The owner relationship automatically supplies the plan-owner role.
Casdoor policies define the actions that role permits. The global server
read-only flag still overrides write permission.

The resource ID derives from the exact OIDC issuer and immutable subject, not
the display name, username, email, or browser input. A new account starts with
an editable blank private plan with no import or administrator approval step.
The plan router activates the empty model on first access. Initialization never
replaces existing financial rows. Existing data stays with its
verified owner. There is no first-login claim of existing data.

Casdoor stores the model, roles, and action/resource rules in its SQLite state.
The backend submits server-derived identity, resource, ownership, and action
values. Browser fields never supply an owner or a trusted role. Permission errors
fail closed. Positive permission decisions do not have an application cache.

## Data isolation

`NET_WORTH_ESTIMATOR_DB` names one shared application database. `app_accounts`
records verified issuer/subject identities. Each private `plans` row references
its owning application account. Financial `accounts` are separate model entities.

Every financial table carries `plan_id`. Keys, uniqueness rules, foreign keys,
ordering, bulk replacement, sync, and artifact retention stay inside that plan.
The database owns the connection. A scoped store holds one immutable plan ID.
No plan-facing operation has an unscoped fallback.

The public sample is the explicitly published `plans/sample` row in that same
database. Its ownership is absent and its API is read-only. An absent sample
grants guests no financial access. Private data never becomes a fallback sample.

All API operations receive the store for the authorized resource. A guessed row
ID in another plan cannot select another plan. Projection artifact identities
and seeded in-flight runs also include the resource ID. Server-level SimpleFIN
credentials remain attached only to the explicitly assigned primary owner.
Other accounts and the sample never inherit that integration.

The sample is a published snapshot, not a live alias of the owner's plan.
`./scripts/dev publish-sample` explicitly publishes the dev primary plan. It
removes private projection history, Bridge links, sync timestamps, and the source
filesystem path from the copy. Later private edits do not change the sample.
Replacing the sample requires another explicit publication.

## Browser isolation

`GET /v1/auth/session` returns the selected resource ID, kind, and capabilities.
Every financial request asserts that ID in `Waypoint-Resource`. The backend
derives the current resource independently and rejects missing or stale assertions
with 409 and problem code `RESOURCE_CHANGED`. The header does not let a caller
select an arbitrary plan. Each save retains its original plan ID. A resource-change
error stops the save and triggers session discovery, never a retry under a new
plan. Ordinary 409 operation conflicts do not trigger session discovery.

Financial responses include the same resource header. The browser namespaces
draft storage by resource and clears active model/projection state before a
resource transition. It does not adopt an old unscoped draft into an account's
plan. Cross-tab login and logout cannot silently retarget an old tab's write.
API clients retain their verification scope. A new verification creates new
clients, while old clients reject further calls before network access. Evaluation
pins and financial preferences also reset and reload within the verified scope.
The old-client check stops canceled work, including after the same plan returns.
The backend alone validates access. Saves do not require a new session lookup.
One browser session hook owns verification, account transitions, and logout.
Rechecks keep the verified workspace mounted while discovery runs. Same-account
rechecks preserve drafts and completed projection results without flicker.
Account, API address, or permission changes reset active workspace data only
after the new resource is verified, then the workspace swaps to the new owner.
Failed checks keep the verified workspace mounted behind a retry banner instead
of wiping the UI; recovery data stays behind the previous account boundary
until that account is verified again. Only an explicit denial or a first load
without a verified session takes over the full screen.

## Deployment and migration

The rule is the same in dev and production. Casdoor is required. Token-only and
unauthenticated server configurations fail closed at startup.

Before an existing authenticated deployment starts the new code:

1. Stop API writes and sync. Back up the application database and Casdoor state.
2. Retain the existing Casdoor issuer, subjects, model, roles, and permissions.
3. Verify guest, owner, second-account, denial, and provider-outage cases.

See [the shared database guide](shared-database.md) for backup and rollback.
Runtime startup rejects legacy unscoped financial databases. It never merges files or guesses an owner.

No source update automatically publishes private data or changes live Casdoor
permissions. Existing reader/editor environment lists no longer define access.
The owner assignment is a one-time data migration, not signup role selection.

## Scope limits

The first resource boundary is the whole plan. Per-row sharing, a plan picker,
an IAM management screen, and cross-account collaboration are not part of this
change. New action/resource policies belong in Casdoor. New resource visibility
must also pass the API's resource-resolution and storage-isolation boundary.

Casdoor's external permission API evaluates the model and stored policy rows.
Use the model's deny rules or remove the relevant policy/binding to revoke
access. Do not treat application-sign-in approval or UI enable flags as an
additional resource-security boundary.

Browser draft namespaces prevent accidental cross-account restoration. Browser
storage remains local to the same browser profile, not an encrypted user vault.
People who share a browser profile can inspect that profile's local data.

Controlling sources:

- [Casdoor permission API](https://casdoor.ai/docs/permission/exposed-casbin-apis/)
- [Permission configuration](https://casdoor.ai/docs/permission/permission-configuration/)
- [Pinned permission model and role policy handling](https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go)
