# Casdoor with local SQLite

Casdoor `v4.23.0` is pinned by image digest. This directory owns initialization,
private identity state, and provider checks. The Go API and frontend stay separate.

## Initialize once

Requires Node 26, Docker, and Docker Compose. Run from the repository root.
Create a private environment file with three distinct random secrets:

```bash
node --input-type=module <<'NODE'
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const example = await readFile('auth/casdoor/.env.example', 'utf8');
const env = example.replace(/^(AUTH_CLIENT_SECRET|CASDOOR_(?:ADMIN|USER)_PASSWORD)=$/gm,
  (_, name) => `${name}=${randomBytes(24).toString('hex')}`);
await writeFile('auth/casdoor/.env', env, { mode: 0o600, flag: 'wx' });
NODE
```

Set `CASDOOR_USER_NAME` in that file. Check both public URLs. Set `CASDOOR_UID`
and `CASDOOR_GID` to your host IDs if necessary. Use HTTPS outside loopback.
Select stable hostnames before passkey enrollment.

```bash
node --env-file=auth/casdoor/.env auth/casdoor/initialize.mjs
```

The initializer generates private configuration and starts Casdoor **once**. It
verifies the ordinary user's generated subject, seals future imports, and writes
private `bootstrap.json`. It refuses existing configuration. If provisioning
fails after startup, correct the cause, then run `provision.mjs` with the same
environment. That command can finish an interrupted seal without another import.

Casdoor creates one normal user and a separate built-in administrator. The seed
allows ordinary account creation and disables built-in administrator signup.
It uses a fresh application signing certificate. Initial
merge mode modifies the built-in signup settings. After provisioning, the config
uses `initDataNewOnly = true` and `initDataMerge = false`. Future restarts preserve
operator changes, generated subjects, passwords, and passkeys.

For normal restarts, reuse the same state without initialization or provisioning:

```bash
docker compose --env-file auth/casdoor/.env \
  -f auth/casdoor/compose.yml -p waypoint-casdoor up -d --wait
```

`CASDOOR_STATE_DIR` selects state. Use an absolute path for combined Compose or
isolated tests. `CASDOOR_PROJECT` selects the initializer project. Ports bind to
loopback. For remote use, provide an HTTPS reverse proxy.

## State and client settings

| State path | Purpose |
| --- | --- |
| `conf/app.conf` | Private runtime configuration and initial administrator secret |
| `conf/init_data.json` | Initial client and user seed, including bootstrap credentials |
| `bootstrap.json` | Verified generated subject, issuer, client ID, and callback. No passwords |
| `db/` | SQLite identities, signing keys, passkeys, tokens, and session metadata |
| `sessions/` | Durable browser sessions for Casdoor's hard-coded file provider |

Files use `0600`. Directories use `0700`. Config mounts read-only. SQLite uses
WAL with a five-second busy timeout. Preserve the whole private state directory
for backups. Keep it outside Git and frontend assets.

The client accepts only code and refresh grants. It uses PKCE S256,
`client_secret_basic` or `client_secret_post`, `JWT-Standard`, one-hour access/ID
tokens, and 720-hour refresh tokens. Request `openid profile email offline_access`.
The account page is `<CASDOOR_PUBLIC_URL>/account`.

Callback: `<APP_PUBLIC_URL>/v1/auth/callback`. Post-logout: `<APP_PUBLIC_URL>/`.
For combined Compose, set the private back-channel target to
`http://backend:8787/v1/auth/backchannel-logout`. Casdoor blocks loopback logout
destinations. Native loopback development can use the API's bounded introspection
fallback. Keep the public OIDC issuer unchanged when private routing is used.

Read the generated subject from `bootstrap.json`. Grant that verified subject
in `NET_WORTH_ESTIMATOR_AUTH_EDITORS` or `NET_WORTH_ESTIMATOR_AUTH_READERS`.
Usernames, emails, and Casdoor administrator roles grant no financial access.

Anonymous app visits redirect to Casdoor's login page. `sign up now` opens
Casdoor's username, display-name, and password form. Newly created identities
return through OIDC to the access-denied screen until the owner grants access.
Signup does not require email or a configured mail service.

Existing initialized instances retain their sealed settings. To enable account
creation there, use Casdoor's application editor for `waypoint`. Enable signup,
disable the self-signup restriction, add the `Signup link` sign-in item, and
configure username/display-name/password/confirmation signup fields. Keep
generated IDs random and built-in administrator signup disabled.

See [combined deployment](../README.md) and [session/recovery rules](../../docs/authentication.md).

## Passwords, passkeys, and recovery

Bootstrap secrets accept 16–72 URL-safe characters. Casdoor uses bcrypt and an
eight-character minimum for later passwords. Login retains password fallback.
Self-service email recovery stays hidden until an operator configures it.

The login UI has username/password fields, an `Auto sign in` checkbox, and a
`Passkey` tab. Add passkeys in the account page's `WebAuthn credentials` section.
Password login remembers the browser for 30 days. In v4.23, passkey login caps
the server session at 24 hours even when the browser cookie advertises 30 days.
Application refresh grants have their own lifetime and revocation checks.

Keep the administrator secret offline as well as in a password manager. Recovery
uses Casdoor's password reset and session-deletion controls, not custom password
code. Remove compromised passkeys too. Follow the contract's physical-device
checklist before production use.

## Verification

```bash
node --test auth/casdoor/*.test.mjs
node --env-file=auth/casdoor/.env auth/casdoor/smoke.mjs
```

The smoke test requires frontend dependencies and Playwright Chromium. It owns
a callback listener at an unused loopback HTTP `APP_PUBLIC_URL`. No application
server is necessary. It adds a virtual passkey. Use disposable identity state.

Set `CASDOOR_RESTART_CONTAINER` to the explicit disposable container name to
verify key and remembered-session persistence. Software checks do not verify
phone passkeys, hardware keys, or real-device recovery.

### Revocation and recovery integration

Use a fresh initialized `CASDOOR_STATE_DIR` under repository `tmp/`. Set the
private back-channel target to `http://backend:8787/v1/auth/backchannel-logout`.
Stop the initializer's standalone project before the combined stack starts.
Set `FRONTEND_PORT` to the registered `APP_PUBLIC_URL` port. Use separate free
Casdoor, frontend, and backend ports. Compose 2.24.4 or newer supports `!override`.

```bash
export AUTH_TEST_DATA_DIR="$PWD/tmp/casdoor-lifecycle-app"
mkdir -m 700 "$AUTH_TEST_DATA_DIR"
export AUTH_TEST_SESSION_DB="$AUTH_TEST_DATA_DIR/identity.db"
export COMPOSE_FILE="docker-compose.yml:auth/compose.casdoor.yml:auth/compose.test.yml"
export NET_WORTH_ESTIMATOR_AUTH_EDITORS="$(
  node --input-type=module -e \
    'import {readFileSync} from "node:fs"; process.stdout.write(JSON.parse(readFileSync(process.env.CASDOOR_STATE_DIR + "/bootstrap.json", "utf8")).subject)'
)"
docker compose --env-file auth/casdoor/.env -p waypoint-auth-test up -d --build --wait
CASDOOR_TEST_MUTATIONS=1 CASDOOR_RESTART_CONTAINER=waypoint-auth-test-casdoor-1 \
  node --env-file=auth/casdoor/.env auth/casdoor/test-lifecycle.mjs
docker compose --env-file auth/casdoor/.env -p waypoint-auth-test down
```

The test overlay replaces the live financial volume with the explicit scratch
directory. It binds app ports to loopback and uses a two-second recheck interval.
The test requires an explicit mutation flag and state paths under `tmp/`. It
temporarily changes the test user's profile/password and the client's token
lifetime. Cleanup restores those fields and deletes test-user provider sessions.

Checks cover sealed restart behavior, real refresh rotation, concurrent requests,
account disablement, OAuth token revocation, administrator session deletion,
password recovery, and signed logout delivery over the private network. A
read-only SQLite connection inspects app grants and logout records. No test
changes the financial database directly. This test does not verify email delivery
or physical passkey devices.

Controlling sources: [seed importer](https://github.com/casdoor/casdoor/blob/v4.23.0/object/init_data.go),
[bootstrap protections](https://github.com/casdoor/casdoor/blob/v4.23.0/object/init.go),
[token introspection](https://github.com/casdoor/casdoor/blob/v4.23.0/controllers/token.go),
[session deletion](https://github.com/casdoor/casdoor/blob/v4.23.0/object/session.go),
[logout tokens](https://github.com/casdoor/casdoor/blob/v4.23.0/object/token_logout.go),
[password reset](https://github.com/casdoor/casdoor/blob/v4.23.0/controllers/user.go), and
[WebAuthn](https://github.com/casdoor/casdoor/blob/v4.23.0/controllers/webauthn.go).
