# Authentication and recovery

Better Auth runs as a Bun service. It owns password verification, passkeys,
provider sessions, and OAuth/OIDC grants. Go never receives login passwords.
The account password-change route forwards credentials to Better Auth over the
private service transport. Authentication setup is in [the auth guide](../auth/README.md).

Deployments never create users. Human accounts use the ordinary signup endpoint
at any time, independent of infrastructure setup or app age. Exceptional ops
account creation uses that same endpoint. No bootstrap owner, initial password,
first-user privilege, or separate account-creation tool exists. Disposable test
fixtures use normal signup and are excluded from deployment images.

## Security boundary

The Go API verifies OIDC signatures, issuer, audience, nonce, state, PKCE, and
token-hash binding when supplied. Its durable application session contains an
opaque grant reference. Provider tokens remain in the private application database.
Application cookies are host-only, HttpOnly, and SameSite=Lax. HTTPS enables Secure
and the `__Host-` prefix. Provider cookies use an issuer-specific namespace.

Better Auth issues opaque access tokens for this confidential client. RFC 7662
introspection binds them to the exact issuer and authenticated `client_id`.
If introspection includes `aud`, Go verifies it too. OIDC ID-token audience checks
always remain mandatory.

Browser mutations require the configured origin. The provider also uses Better
Auth's CSRF checks and database-backed rate limits. Passwords use bcrypt. Signup
collects only username and password. The username supplies the initial display name.
Internal `users.invalid` email
addresses satisfy the provider schema without a mail dependency. They are not
recovery addresses. Clients cannot assign the provider's disabled flag.

Rate limits use the socket address on direct deployments. An operator can select
an ingress-owned client-IP header only when the ingress replaces client values on
every public path. Northflank public HTTP ingress supplies
`X-Envoy-External-Address`; internal and VPC requests do not carry that guarantee.
See [Northflank networking](https://northflank.com/docs/v1/application/network/networking-on-northflank)
and [Better Auth rate limits](https://better-auth.com/docs/concepts/rate-limit).

The account page manages passkeys on the canonical identity hostname. Passkeys
require HTTPS or loopback. They do not move to an alias hostname. Keep password
fallback and a second passkey on a separate device.

## Sessions and revocation

Application sessions have an absolute deadline, default seven days. Refresh does
not extend it. Concurrent requests share one refresh per persisted grant.
The next request after the provider recheck interval verifies the token, default
30 seconds and configurable from one second to five minutes. Inactive grants lose
private access. Provider failures return 503 when a check is due, without deleting
the grant. Admitted requests and SSE streams can finish.

Deleting a provider session revokes its access and refresh tokens before deletion.
This prevents offline tokens from surviving through nullable session references.
Password change revokes the user's application grants and provider sessions.
App logout deletes its grant and follows the provider end-session URL. HTTPS
clients register signed back-channel logout at the public app callback. Loopback
development uses introspection when no HTTPS back-channel route exists.

`GET /v1/auth/session` discovers identity and authorized resources. Anonymous
requests use the provisioned guest subject, not private user data. Every financial
request asserts the selected resource through `Waypoint-Resource`. See
[authorization](authorization.md) for policy and isolation guarantees.

## Device clients

CLI and browser-extension clients retain the device start, poll, and refresh
contract. Better Auth supplies the RFC 8628 authorization flow. Users enter and
approve the code at the provider's device page. Each code binds to the verifying
browser session before approval. Device credentials stay separate from browser
cookies. Go introspects bearer tokens on every request.

## Browser addresses

`NET_WORTH_ESTIMATOR_PUBLIC_URL` and `NET_WORTH_ESTIMATOR_AUTH_ISSUER` identify the
canonical app and provider. `NET_WORTH_ESTIMATOR_AUTH_INTERNAL_URL` changes only
server transport. Additional app/provider origins use
`NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS` during explicit provider provisioning
and API configuration. Each app callback must be registered. The provider gateway
isolates cookies and preserves the canonical issuer. Sibling-origin writes fail
closed. Shared tailnet Serve routes must not change during development.

## Recovery and backups

No mail-based recovery is enabled. An operator must verify the user's identity
before an offline password reset. Never change the immutable subject to restore
access. Revoke sessions and offline tokens after credential compromise. Policy
revocation is separate and immediate through the Casbin policy database.

Back up identity storage, application storage, policy storage, and private
configuration. Use PostgreSQL dumps or SQLite-safe snapshots. These stores contain
credentials and private data. Restore the same issuer, subjects, and auth secret.
A backup can restore old credentials, so revoke them again after incident recovery.

## Manual physical-device and recovery checklist

1. Enroll a passkey on the canonical HTTPS hostname.
2. Sign out and sign in with that passkey.
3. Verify password fallback on another device.
4. Enroll and verify a backup passkey.
5. Remove one key and verify that it no longer authenticates.
6. Revoke sessions and verify that old cookies cannot access private data.
7. Exercise the offline recovery procedure on disposable state.

Physical authenticators and external recovery delivery remain manual checks.
