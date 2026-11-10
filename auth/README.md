# Authentication and authorization

Better Auth on Bun owns passwords, passkeys, OAuth grants, and provider sessions. The Go API verifies OIDC and maintains durable application sessions, and embedded Go Casbin evaluates user-resource policies from the separate application-owned authorization database. Financial ownership derives from the exact issuer and immutable subject.

Application sessions have an absolute deadline of seven days by default, configurable through `NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME`, and refresh does not extend it. The next request after the provider recheck interval re-verifies the token. Deleting a provider session revokes its tokens, password change revokes the user's grants and sessions, and logout deletes the grant. Device clients use the RFC 8628 start, poll, and refresh flow with a code approved at the provider. No mail-based recovery exists; an operator verifies identity before an offline password reset and never changes the immutable subject. Back up identity, application, policy, and private configuration together and restore the same issuer, subjects, and auth secret.

## Fresh installation

Use Bun 1.4.4 and install dependencies from the repository root:

```bash
bun install --frozen-lockfile
```

Set private environment values. Generate distinct random secrets of at least 32 characters for `BETTER_AUTH_SECRET` and `AUTH_CLIENT_SECRET`.

```text
AUTH_PUBLIC_URL=https://identity.example.com
APP_PUBLIC_URL=https://app.example.com
AUTH_DATABASE=/private/identity.db
BETTER_AUTH_SECRET=<private-random-secret>
AUTH_CLIENT_ID=waypoint
AUTH_CLIENT_SECRET=<different-private-random-secret>
```

`AUTH_DATABASE` also accepts a PostgreSQL connection URI. Use a fresh database or an isolated schema selected through PostgreSQL `search_path`; never reuse old identity tables. Preserve the auth secret across restarts because it protects signing keys and cookies.

```bash
bun run auth/better-auth/src/setup.ts
```

This initializes the schema and the first-party OAuth client only. It creates no users, password credentials, or sessions, and there is no bootstrap owner or deployment password. Users sign up through `/sign-up` at any point; exceptional ops account creation submits the same request.

Provision application storage and the guest workspace before API startup. Guest provisioning is separate from human signup, and no deployment creates a provider account for the guest:

```bash
go -C backend run ./cmd/setupdb --db /private/application.db
go -C backend run ./cmd/setupdb --db /private/application.db --issuer "$AUTH_PUBLIC_URL" --subject "$GUEST_SUBJECT"
go -C backend run ./cmd/authzctl --setup --db /private/authorization.db --issuer "$AUTH_PUBLIC_URL" --guest "$GUEST_SUBJECT"
```

Configure the Go API with the same issuer and client credentials, its public app URL, `NET_WORTH_ESTIMATOR_GUEST_SUBJECT`, and `NET_WORTH_ESTIMATOR_AUTHZ_DB`. `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` is `better-auth`. An optional internal URL changes transport only, never the verified issuer.

Public identity and application callbacks require HTTPS except on loopback; the OAuth 2.1 provider does not permit plain-HTTP LAN callback addresses. For a public Northflank identity port, set `AUTH_CLIENT_IP_HEADER=x-envoy-external-address` only where every public request uses that ingress. Never trust browser-supplied `X-Forwarded-For` or an unverified client-IP header.

Build the provider browser bundle, then start Bun:

```bash
bun --filter @waypoint/auth build
bun run auth/better-auth/src/server.ts
```

For Compose, merge `docker-compose.yml` and `auth/compose.auth.yml`, and set `AUTH_STATE_DIR` to the private identity directory. Neither server creates or repairs its schema. Use `./dev/main.mjs setup --slot NAME` for isolated development.

## Existing installations

Follow [the one-time cutover](better-auth/one-time/README.md). It preserves the issuer and every immutable subject, imports bcrypt credentials and reviewed effective permissions, ends old sessions, and requires fresh passkey enrollment.

## Verification

```bash
bun --filter @waypoint/auth typecheck
bun --filter @waypoint/auth test
CGO_ENABLED=0 go -C backend test ./internal/authorization ./internal/identity ./cmd/server
node --test dev/*.test.mjs
E2E_TEST_MUTATIONS=1 scripts/test --e2e
```
