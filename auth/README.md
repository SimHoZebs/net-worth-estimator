# Authentication and authorization

Waypoint uses Better Auth on Bun for authentication and embedded Go Casbin for
authorization.

Better Auth owns passwords, passkeys, OAuth grants, and provider sessions. The Go
API verifies OIDC and maintains durable application sessions. Casbin evaluates
user-resource policies from the separate application-owned authorization database.
Financial ownership still derives from the exact issuer and immutable subject.

## Fresh installation

Use Bun 1.4.4 and install dependencies from the repository root:

```bash
bun install --frozen-lockfile
```

Set private environment values. Generate distinct random secrets of at least
32 characters for `BETTER_AUTH_SECRET` and `AUTH_CLIENT_SECRET`.

```text
AUTH_PUBLIC_URL=https://identity.example.com
APP_PUBLIC_URL=https://app.example.com
AUTH_DATABASE=/private/identity.db
BETTER_AUTH_SECRET=<private-random-secret>
AUTH_CLIENT_ID=waypoint
AUTH_CLIENT_SECRET=<different-private-random-secret>
```

`AUTH_DATABASE` also accepts a PostgreSQL connection URI. Use a fresh database or
an isolated, explicitly created schema selected through PostgreSQL `search_path`.
Never reuse the old identity tables. Preserve the auth secret across restarts because
it protects signing keys and cookies.

```bash
bun run auth/better-auth/src/setup.ts
```

This initializes schema and the first-party OAuth client only. It creates no
users, password credentials, or sessions. The client belongs to the application,
not a human account. There is no bootstrap owner and no deployment password.

User creation is independent of deployment. Users sign up through `/sign-up` at
any point. If ops needs to create an account exceptionally, it submits the same
signup request. There is no separate account-creation CLI or privileged path.

Provision application storage and the configured anonymous guest workspace before
API startup. Guest workspace provisioning is separate from human account signup.
An existing disabled guest identity can retain its subject. No deployment creates
a provider account for it:

```bash
go -C backend run ./cmd/setupdb --db /private/application.db
go -C backend run ./cmd/setupdb --db /private/application.db --issuer "$AUTH_PUBLIC_URL" --subject "$GUEST_SUBJECT"
go -C backend run ./cmd/authzctl --setup --db /private/authorization.db --issuer "$AUTH_PUBLIC_URL" --guest "$GUEST_SUBJECT"
```

Configure the Go API with the same issuer/client credentials, its public app URL,
`NET_WORTH_ESTIMATOR_GUEST_SUBJECT`, and `NET_WORTH_ESTIMATOR_AUTHZ_DB`.
`NET_WORTH_ESTIMATOR_AUTH_PROVIDER` is `better-auth`. An optional internal URL
changes transport only, never the verified issuer.

Public identity and application callbacks require HTTPS except on loopback.
The OAuth 2.1 provider does not permit plain-HTTP LAN callback addresses. Use
the existing HTTPS tailnet routes instead. Internal container transport can use HTTP.

For a public Northflank identity port, set
`AUTH_CLIENT_IP_HEADER=x-envoy-external-address`. Northflank replaces that header
with the connecting client's address. Enable this only where every public request
uses that ingress. Internal and VPC paths do not provide that guarantee.
Direct deployments leave the setting unset and use Bun's socket address. Never
trust browser-supplied `X-Forwarded-For` or an unverified client-IP header.

Build the provider browser bundle, then start Bun:

```bash
bun --filter @waypoint/auth build
bun run auth/better-auth/src/server.ts
```

For Compose, merge `docker-compose.yml` and `auth/compose.auth.yml`. Set
`AUTH_STATE_DIR` to the private identity directory. Neither server creates or
repairs its schema. Use `./dev/main.mjs setup --slot NAME` for isolated development.

## Existing installations

Follow the [one-time cutover](better-auth/one-time/README.md). It preserves the
issuer and every immutable subject. It imports bcrypt credentials and reviewed
effective permissions. Old sessions end. Users enroll fresh passkeys.

## Verification

```bash
bun --filter @waypoint/auth typecheck
bun --filter @waypoint/auth test
CGO_ENABLED=0 go -C backend test ./internal/authorization ./internal/identity ./cmd/server
node --test dev/*.test.mjs
E2E_TEST_MUTATIONS=1 scripts/test --e2e
```
