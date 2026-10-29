# Account-scoped authorization

Casdoor authenticates accounts and hosts the Casbin authorization model. The Go
API calls Casdoor's permission API with private application credentials. It does
not embed a second Casbin engine or evaluate a custom policy language.

## Resources, actions, and roles

An account scope is the permission boundary. Its accounts, postings, recurrence
rules, checkpoints, evaluations, presets, pinned results, sync links, and
projection artifacts stay inside that boundary.

| Principal             | Resource (wire)             | Storage scope            | Default capabilities                      |
| --------------------- | --------------------------- | ------------------------ | ----------------------------------------- |
| Guest                 | `plans/sample`              | `sample`                 | `plan:read`, `plan:project`               |
| Verified account      | Its own `plans/<identity-hash>` | Its own `user:<identity-hash>` | `plan:read`, `plan:project`, `plan:write` |
| Any other combination | Another account's plan      | Another account's scope  | Denied                                    |

The wire resource IDs are unchanged in this change: session discovery,
`Waypoint-Resource` assertions, and Casdoor policies still use `plans/*`.
`user:<hash>`, `sample`, and `fixture` are storage scopes. The storage layer
maps between them (`NormalizeAccountID`/`ResolveAccountID`), so operator
tooling and `Database.Plan`/`Account` lookups accept either form.

Signed-in accounts use their private scope, not the sample. Signup does not ask
for a role. The owner relationship automatically supplies the plan-owner role.
Casdoor policies define the actions that role permits. The global server
read-only flag still overrides write permission.

The resource ID derives from the exact OIDC issuer and immutable subject, not
the display name, username, email, or browser input. A new account starts with
an editable blank private scope with no import or administrator approval step.
The plan router activates the empty model on first access. Initialization never
replaces existing financial rows. Existing data stays with its
verified owner. There is no first-login claim of existing data.

The storage layer normalizes `plans/<hash>` to the owner's `user:<hash>`
scope and `plans/sample` to `sample`, so either form selects the same stored
data. Browser state stays namespaced by the verified resource: state saved
under a different resource key is never restored into the current scope (it
stays orphaned under its old key and is never adopted).

Casdoor stores the model, roles, and action/resource rules in its SQLite state.
The backend submits server-derived identity, resource, ownership, and action
values. Browser fields never supply an owner or a trusted role. Permission errors
fail closed. Positive permission decisions do not have an application cache.

## Data isolation

`NET_WORTH_ESTIMATOR_DB` names one shared application database. `app_accounts`
records verified issuer/subject identities. Each private scope is keyed by its
owning application account ID (`user:<hash>`). Wire requests keep addressing
it as `plans/<hash>`; the resource header must equal the session resource. Financial `accounts` are separate
model entities.

Every financial table carries `account_id`. Keys, uniqueness rules, foreign keys,
ordering, bulk replacement, sync, and artifact retention stay inside that
account. Model-account references use distinct column names
(`model_account_id`, `source_account_id`, `bridge_account_id`), so the scope
column never collides with a financial reference. The database owns the
connection. A scoped store holds one immutable account ID.
No scope-facing operation has an unscoped fallback.

The public sample is the explicitly published scope in that same
database (wire resource `plans/sample`, storage scope `sample`). Its ownership is absent and its API is read-only. An absent sample
grants guests no financial access. Private data never becomes a fallback sample.

All API operations receive the store for the authorized resource. A guessed row
ID in another account cannot select another account. Projection artifact identities
and seeded in-flight runs also include the resource ID. Server-level SimpleFIN
credentials remain attached only to the explicitly assigned primary owner.
Other accounts and the sample never inherit that integration.

The sample is a published snapshot, not a live alias of the owner's scope.
`./scripts/dev publish-sample` explicitly publishes the dev primary scope. It
removes private projection history, Bridge links, sync timestamps, and the source
filesystem path from the copy. Later private edits do not change the sample.
Replacing the sample requires another explicit publication.

## Browser isolation

`GET /v1/auth/session` returns the selected resource ID, kind, and capabilities.
Every financial request asserts that ID in `Waypoint-Resource`. The backend
derives the current resource independently and rejects missing or stale assertions
with 409 and problem code `RESOURCE_CHANGED`. The header does not let a caller
select an arbitrary resource. Each save retains its original scope. A resource-change
error stops the save and triggers session discovery, never a retry under a new
resource. Ordinary 409 operation conflicts do not trigger session discovery.

Financial responses include the same resource header. The browser namespaces
draft storage by resource and clears active model/projection state before a
resource transition. It does not adopt an unscoped draft into an account's
scope. Cross-tab login and logout cannot silently retarget an old tab's write.
API clients retain their verification scope. A new verification creates new
clients, while old clients reject further calls before network access. Evaluation
pins and financial preferences also reset and reload within the verified scope.
The old-client check stops canceled work, including after the same scope returns.
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

The rule is the same in dev and production. Casdoor is required. Without it
the server fails closed at startup.

Before an existing authenticated deployment starts the new code:

1. Stop API writes and sync. Back up the application database and Casdoor state.
2. Retain the existing Casdoor issuer, subjects, model, roles, and permissions.
3. Run setup once: `setupdb` migrates `shared-plans-v1` databases to the
   `shared-accounts-v1` account scope in place (stored scope `plans/<hash>`
   backfills to its owner's `user:<hash>`; the guest sample becomes the
   reserved `sample` scope). Wire resource IDs are unchanged: sessions and
   `Waypoint-Resource` assertions keep using `plans/*`. The
   migration is idempotent and verifies the final schema before the server
   starts. Keep the pre-migration backup until the new code serves traffic.
4. Verify guest, owner, second-account, denial, and provider-outage cases.

See [the shared database guide](shared-database.md) for backup and rollback.
Runtime startup rejects legacy unscoped financial databases. It never merges files or guesses an owner.

No source update automatically publishes private data or changes live Casdoor
permissions. The owner assignment is a one-time data migration, not signup role selection.

## Scope limits

The first resource boundary is the whole account scope. Per-row sharing, a scope
picker, an IAM management screen, and cross-account collaboration are out of scope. New action/resource policies belong in Casdoor. New resource visibility
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
