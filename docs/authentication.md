# Authentication and recovery

Casdoor is the mainline identity provider. It owns password verification,
passkeys, browser sign-in, and its local SQLite identity database. The Go API
never receives passwords or passkey private keys. The Better Auth experiment
remains on local branch `experiment/better-auth`.

## Security boundary

The Go API verifies OIDC signature, issuer, audience, nonce, state, PKCE, and any
access-token hash binding. It uses SCS for durable application sessions. Cookies
are HttpOnly and SameSite=Lax. HTTPS adds Secure and the `__Host-` prefix.

The private identity database defaults to `<financial-db>.sessions`. It stores
hashed application-session IDs, provider grants, and logout replay records.
Provider grants contain access, refresh, and ID tokens. SCS sessions hold only
opaque grant references. Protect this database as a credential store.

Casdoor's built-in Casbin system grants actions on plan resources. Guests can
read and project only a separate published sample. Each signed-in account can
read and edit only its own private plan. Signup has no role-selection or manual
grant step. Plans, artifacts, sync state, and browser drafts remain isolated.
See [plan-scoped authorization](authorization.md) for the resource and migration
contract. The global read-only switch still rejects editor writes.

The sidebar offers sign-in and account creation for guests. Casdoor owns signup,
password checks, and passkeys. Built-in administrator signup stays disabled.
The default signup form does not collect email or require a mail service.

## Configuration

| Setting | Meaning |
| --- | --- |
| `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` | `casdoor` (default and only supported provider) |
| `NET_WORTH_ESTIMATOR_AUTH_ISSUER` | Exact public issuer from OIDC discovery |
| `NET_WORTH_ESTIMATOR_AUTH_INTERNAL_URL` | Optional private container origin. Public issuer verification remains unchanged |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID` | Confidential OIDC client |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET` | Private client credential |
| `NET_WORTH_ESTIMATOR_PUBLIC_URL` | Frontend origin, without a path |
| `NET_WORTH_ESTIMATOR_AUTH_ACCOUNT_URL` | Optional account/passkey page on the issuer origin |
| `NET_WORTH_ESTIMATOR_AUTH_PERMISSION_MODEL` | Casdoor model ID, default `waypoint/plan-access` |
| `NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT` | Verified owner of the existing primary financial database |
| `NET_WORTH_ESTIMATOR_PLANS_DIR` | Private per-account database directory, default `<financial-db>.plans` |
| `NET_WORTH_ESTIMATOR_SAMPLE_DB` | Separate, explicitly published read-only guest sample database |
| `NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME` | Absolute application lifetime, default `168h` |
| `NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL` | Provider recheck interval, default `30s`, range `1s`–`5m` |
| `NET_WORTH_ESTIMATOR_AUTH_SESSION_DB` | Optional identity/session database path |

Register the callback `<PUBLIC_URL>/v1/auth/callback` and post-logout redirect
`<PUBLIC_URL>/`. Configure Casdoor for code plus refresh grants, PKCE S256,
`JWT-Standard`, introspection, and signed back-channel logout. The initializer
sets these fields. It uses one-hour access/ID tokens and 30-day refresh grants.

The frontend and API share one public origin through the proxy. The proxy
preserves Origin for Go's browser CSRF protection. Dev and production use the
same Casdoor session boundary. The server rejects the retired `AUTH_TOKEN`
setting and `AUTH_PROVIDER=none` before it opens financial storage. Missing
identity settings stop startup rather than expose an unauthenticated API.
Cross-origin session login is outside this integration.

`GET /v1/auth/session` supplies identity and resource-capability discovery.
The API checks Casdoor's resource permissions before any plan read or write.
Guests read only sample status, which reports `readOnly: true`. Authentication
discovery belongs to `/v1/auth/session`; status no longer contains `authEnabled`.
The frontend has no shared-token prompt or token state. Its API client uses
session cookies and strips caller-supplied Authorization headers.

The isolated `cmd/fixtureapi` browser-test harness intentionally omits identity.
That executable is not a supported deployment or manual-development entry point.

Assign existing primary data to its verified owner before migration. New
accounts receive their own empty private plan. Casdoor owns action/resource
policies. Retired `AUTH_READERS`/`AUTH_EDITORS` lists do not grant plan access.

## Session lifecycle

Application sessions have an absolute deadline. Refresh never extends it. The
next request refreshes tokens near their expiry. Concurrent requests share one
refresh per grant. Rotated credentials persist before the next provider check.
Expired application sessions lose private-plan access. A guest session uses
only the sample resource. Casdoor can reuse its browser session for a new
sign-in without another credential prompt.

App logout deletes its provider grant and SCS session, then returns Casdoor's
end-session URL. A captured app cookie cannot restore that grant. The browser
must follow the URL to end the provider browser session too.

Casdoor sends signed logout tokens to `/v1/auth/backchannel-logout`. The receiver
verifies signature, issuer, audience, issue time, logout event, and token ID. It
rejects a nonce and expired optional expiry. Persistent replay records and
revocation markers block retries, delayed callbacks, and stale refresh results.
This endpoint uses signed tokens, not browser cookies.

Casdoor 4.23 omits `sid` from ID tokens. The receiver conservatively deletes all
grants for the subject when it cannot match a precise provider session.

Introspection covers disabled/deleted users, revoked tokens, administrator session
deletion, and password resets. The next request after the configured interval
checks the provider. An inactive token deletes the app grant and removes private
plan access. Old private-resource assertions return 409. Guest writes return 401.
A provider outage returns 503 when verification is due, retaining the grant for
retry. Cached verification remains valid until the interval ends. Requests and
SSE streams already admitted can finish. Revocation does not cancel them.

Use `http://backend:8787/v1/auth/backchannel-logout` inside combined Compose.
Casdoor permits private RFC1918 destinations but rejects loopback, link-local,
and shared-address-space destinations for logout delivery. Native loopback tests
therefore rely on introspection unless they use a private callback route.

Casdoor password login remembers browsers for 30 days. Its v4.23 passkey flow
caps the provider session at 24 hours despite a 30-day cookie. Application
refresh grants remain separate. They can outlive that provider browser session
until revoked or their own deadline ends.

## Account recovery

Keep the Casdoor administrator credential in a password manager with an offline
recovery copy. Use a separate normal account for financial access. Enroll a
second passkey on a separate device before you rely on passkey-only access.
The default setup retains password fallback. Email self-service recovery stays
disabled until an operator configures and verifies a Casdoor email provider.

If a user loses a device:

1. Use the backup passkey or password to access the Casdoor account page.
2. Remove the lost device's credential in Casdoor.
3. Reset the password if it could be compromised.
4. Delete that user's provider sessions in Casdoor's Sessions page.
5. Confirm old cookies cannot write or read the asserted private resource.
6. Enroll and verify a replacement passkey.

If all user credentials are lost, use the separate Casdoor administrator account
to reset the user's password and remove compromised passkeys. Delete the user's
provider sessions too. Password reset expires OAuth tokens but does not replace
the explicit session-deletion step. Never change the user's immutable subject
to recover access. Do not grant the administrator access to the financial plan.

For immediate resource exclusion, add a Casdoor deny policy for the exact actor,
plan resource, and actions in the same plan model/adapter. Permission checks have
no positive application cache. Also revoke provider credentials to prevent later
reuse. Rotate the OIDC client
secret if that secret leaks. Restore service only after both sides use it.

## Backups and restore

Back up financial SQLite data, Casdoor's whole state directory, and private
deployment configuration. Casdoor state includes signing keys and persistent
file sessions. Use a stopped service or SQLite-safe backup method. Copying only
an active database file can omit WAL data. Keep the identity/session database
separate from financial imports and public assets.

Restore to the same issuer hostname and preserve generated subjects. Passkeys
bind to that hostname. A new identity database or issuer needs an explicit plan
ownership/resource migration and passkey enrollment. Automatic identity migration
is outside scope.

A credential-store backup can restore old sessions and tokens. After incident
recovery, revoke provider sessions and tokens again. With the API stopped,
remove only its identity/session database and SQLite companions to force all
application users through sign-in again. Keep financial data intact.

## Verification

```bash
backend/scripts/verify.sh ./internal/identity
backend/scripts/verify.sh ./internal/authorization
backend/scripts/verify.sh ./internal/plans
backend/scripts/verify.sh ./internal/api
go -C backend test -race ./internal/identity
node --test auth/casdoor/*.test.mjs
```

Mock-provider tests cover OIDC validation, access control, CSRF, callback replay,
persistence, refresh races, rotation during outages, inactive grants, signed
logout validation, persistent replay, and delayed callback/refresh rejection.
Real-provider browser checks live under `auth/`. Use disposable identities.

### Manual physical-device and recovery checklist

- [ ] Enroll a phone passkey over the final HTTPS hostname.
- [ ] Enroll a separate hardware key or second device.
- [ ] Sign in with each device from a fresh browser session.
- [ ] Check mobile browser prompts, cancellation, and password fallback.
- [ ] Remove one credential and confirm it cannot sign in again.
- [ ] Test lost-device recovery with the remaining credential.
- [ ] Test administrator password reset and provider-session deletion.
- [ ] Confirm captured app cookies fail after the recheck interval.
- [ ] Restore a disposable backup and confirm stable subjects and signing keys.

Virtual-authenticator tests do not establish any physical-device checklist item.
Go 1.27.3 is the minimum toolchain for the authentication transport's security
fixes. The API container pins that patch release.
