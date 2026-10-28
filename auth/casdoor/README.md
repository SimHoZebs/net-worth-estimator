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
and `CASDOOR_GID` to your host IDs if necessary. HTTP and HTTPS origins are
both accepted; expose plain HTTP only on a trusted private LAN. Select stable
hostnames before passkey enrollment. For trusted-LAN plain HTTP, use LAN HTTP
URLs and set `CASDOOR_BIND=0.0.0.0`. LAN HTTP is password-only.

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
loopback unless `CASDOOR_BIND` overrides it for trusted-LAN HTTP. For remote use
outside a trusted LAN, provide an HTTPS reverse proxy.

## State and client settings

| State path            | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `conf/app.conf`       | Private runtime configuration and initial administrator secret            |
| `conf/init_data.json` | Initial client and user seed, including bootstrap credentials             |
| `bootstrap.json`      | Verified generated subject, issuer, client ID, and callback. No passwords |
| `db/`                 | SQLite identities, signing keys, passkeys, tokens, and session metadata   |
| `sessions/`           | Durable browser sessions for Casdoor's hard-coded file provider           |

Files use `0600`. Directories use `0700`. Config mounts read-only. SQLite uses
WAL with a five-second busy timeout. Preserve the whole private state directory
for backups. Keep it outside Git and frontend assets.

The client accepts code, refresh, and device-code grants. It uses PKCE S256,
`client_secret_basic` or `client_secret_post`, `JWT-Standard`, one-hour access/ID
tokens, and 720-hour refresh tokens. Request `openid profile email offline_access`.
The account page is `<CASDOOR_PUBLIC_URL>/account`.

Callback: `<APP_PUBLIC_URL>/v1/auth/callback`. Post-logout: `<APP_PUBLIC_URL>/`.
For combined Compose, set the private back-channel target to
`http://backend:8787/v1/auth/backchannel-logout`. Casdoor blocks loopback logout
destinations. Native loopback development can use the API's bounded introspection
fallback. Keep the public OIDC issuer unchanged when private routing is used.

`bootstrap.json` records the provider's generated subject. Application permissions
and per-account plans follow [the authentication contract](../../docs/authentication.md).
Branding does not change permissions, account policy, or plan ownership.

Application sign-in sends the browser to Casdoor. `sign up now` opens Casdoor's
username, display-name, and password form. Signup returns through the existing
OIDC callback. It does not require email or a configured mail service.
New accounts receive an editable blank private workspace immediately. No
administrator confirmation or financial-model import is required.

Existing initialized instances retain their sealed settings. To enable account
creation there, use Casdoor's application editor for `waypoint`. Enable signup,
disable the self-signup restriction, add the `Signup link` sign-in item, and
configure username/display-name/password/confirmation signup fields. Keep
generated IDs random and built-in administrator signup disabled.

See [combined deployment](../README.md) and [session/recovery rules](../../docs/authentication.md).

## Command-line access

The `nwe` CLI signs in through the device flow and then calls the same API
as the frontend. No password or application secret leaves the server:

```bash
export NWE_API=https://app.example.test
go run ./backend/cmd/nwe login
go run ./backend/cmd/nwe status
go run ./backend/cmd/nwe api POST /v1/sync/simplefin --data @trigger.json
```

`login` prints a verification URL plus a user code. Approve it in the
browser. The CLI caches tokens owner-only (`0600`) and refreshes them
without further approval. Every request carries the cached plan resource,
so `Waypoint-Resource` checks and `plan:write` enforcement behave exactly
like browser traffic. `logout` wipes the local cache; issued tokens expire
on their own.

Fresh seeds include the device-code grant. Existing sealed instances need
one manual step: enable `Device Code`
(`urn:ietf:params:oauth:grant-type:device_code`) in Grant types on the
`waypoint` application through Casdoor's application editor. The branding
apply flow preserves grant types, so it never removes this access. The CLI
caches its base URL nowhere, so keep `NWE_API` exported (or pass `--api` to
every command). Compromised tokens stop working immediately only when
revoked from the account page; otherwise they expire on their own.

## Plan permissions

Fresh initialization includes the `waypoint/plan-access` Casbin model, the
plan-owner and guest roles, and one dedicated same-database policy adapter.
Casdoor evaluates `plan:read`, `plan:project`, and `plan:write` on plan resources.
Owners receive actions on their private plan automatically. Guests receive only
read/project actions on a separate sample. Signup needs no role choice or
permission-object write.

Existing sealed instances require an explicit policy installation. Preview it
offline, review the exact JSON, and approve its SHA-256 before any shared write:

```bash
node --env-file=auth/casdoor/.env auth/casdoor/apply-permissions.mjs --preview
```

After approval, run the same command with `--apply <approved.json>`,
`--sha256 <approved-digest>`, and `--backup <new-private-backup.json>`. Set
`CASDOOR_STATE_DIR` to the existing sealed state. The command adds missing
objects only. It refuses drift, extra model permissions, unknown versions,
and mismatched application identity. It never overwrites operator policies.
The API fails closed until the permission model resolves.

The application still owns plan storage isolation. See the
[authorization contract](../../docs/authorization.md) for existing-data ownership,
sample publication, per-account stores, and resource-header checks.

## Waypoint hosted login and signup branding

New seeds include the Waypoint mark, outlined wordmark, emerald/stone palette,
and Manrope font. Casdoor retains its own forms, labels, tabs, errors, password
checks, passkeys, and OIDC flow. No custom credential form replaces them.
The emerald colors match the current Tailwind palette's sRGB equivalents:
`#007a55` in light mode and `#5ee9b5` in dark mode.

`branding.mjs` builds the presentation from checked-in assets under `branding/`.
Logo, favicon, and font use embedded data URLs. Branding requires no external
font service, asset upload, container mount, or frontend build. The Manrope Latin
font is the unmodified `@fontsource-variable/manrope@5.3.0` file, under
[`branding/OFL.txt`](branding/OFL.txt). Its SHA-256 is
`a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972`.
The SVG wordmark outlines use Manrope weight 700. The mark preserves the geometry
in `frontend/src/components/Brand.tsx`.

Visible application content:

- Browser title: `Waypoint account`.
- Desktop eyebrow: `A CLEARER FINANCIAL PICTURE`.
- Desktop heading: `Make room for what comes next.`
- Desktop text: `A clearer view of your money, today and ahead.`
- Footer: none. `footerHtml` is empty; no provider attribution renders.

The native UI supplies `Password`, `Passkey`, `Sign In`, `Sign Up`, field labels,
and account links. Branding makes no claims about financial access or plan sharing.

### Existing sealed instances: preview, approve, then apply

Existing instances keep their sealed settings. Source changes do not update them.
Do not rerun initialization, generation, provisioning, or seed import for branding.

Create a new local approval directory. This command reads only public target
settings and checked-in assets. It performs no network requests:

```bash
node --env-file=auth/casdoor/.env auth/casdoor/branding.approval.mjs \
  --output /tmp/opencode/waypoint-branding-review
```

Open `review.html` in that directory. Review the target issuer/client, visible
content, and every exact field value. `plan.json` contains the exact proposed
values. `plan.sha256` pins its bytes. Obtain explicit approval for that content
and target before a shared-system write. A summary or source approval is insufficient.

After approval, set `CASDOOR_STATE_DIR` to the existing sealed state directory.
Use the matching environment file and current built-in administrator credential.
Choose a new private backup filename:

```bash
node --env-file=auth/casdoor/.env auth/casdoor/apply-branding.mjs \
  --apply /tmp/opencode/waypoint-branding-review/plan.json \
  --sha256 <approved-plan-sha256> \
  --backup /path/to/private/previous-waypoint-branding.json
```

The command changes these application fields only:

```text
logo logoDark title favicon headerHtml footerHtml formCss formCssMobile
formOffset formSideHtml formBackgroundUrl formBackgroundUrlMobile themeData
```

The apply command:

1. Requires the exact approved bytes, current source values, and matching target.
2. Checks the SQLite driver, sealed import flags, and bootstrap issuer/client metadata.
3. Refuses an existing backup path before any network request.
4. Authenticates through Casdoor as the built-in administrator.
5. Requires server version `v4.23.0` with commit offset zero.
6. Checks `admin/waypoint`, its organization/client, and absence of replacement forms.
7. Saves previous presentation fields to a new `0600` file.
8. Rechecks the application snapshot before its update.
9. Verifies presentation values and every unchanged non-presentation field.
10. Ends its administrator session, including after an update failure.

Casdoor v4.23 uses Xorm `MustCols` for the API's `columns` parameter. This forces
empty values to update, but it does **not** restrict other nonempty fields.
The command therefore sends a sparse body: the branding fields, unchanged name,
and the `***` client-secret mask. It sends no client ID, organization, providers,
grants, callback URLs, token settings, or full application snapshot. Casdoor uses
the mask to omit its stored client secret. Native-provider tests verify this path.

Avoid concurrent application-editor changes during apply. Casdoor offers no
conditional-update transaction for this endpoint. A failed post-update check
preserves the backup and stops without automatic rollback. Review that backup
before any manual restoration through Casdoor's application editor. The backup
contains presentation fields only. Do not import it as a full application or
unseal seed imports. Fresh page navigation displays the new branding. No runtime
restart is necessary.

### Scope and version limits

- Desktop uses Casdoor's supported side panel. Mobile uses its native single column.
- The provider's theme preference controls light/dark mode independently of Waypoint.
- Account profile, password change, and app-session revocation are native Waypoint screens backed by a thin Casdoor proxy. Passkey enrollment, removal, and recovery remain Casdoor-owned screens.
- Browser and operating-system passkey prompts retain their platform appearance.
- Organization and administrator-console branding remain unchanged.
- Casdoor can show default icons or its startup screen before application data loads.
- Casdoor injects `headerHtml` once per page. Its font can persist across SPA navigation.
- Embedded authentication frames skip custom form CSS under Casdoor's own rules.

The longer SVG data URLs work with this repository's pinned SQLite deployment.
SQLite does not enforce the model's `varchar(200)` logo/favicon widths. Recheck
asset storage before a database-engine change. Do not assume the same strings
fit a length-enforcing SQL database. All branding fields and native layout hooks
must receive another review before a Casdoor upgrade.

Controlling sources for v4.23.0:
[native auth layout](https://github.com/casdoor/casdoor/blob/v4.23.0/web/src/components/auth/AuthLayout.tsx),
[head/theme hooks](https://github.com/casdoor/casdoor/blob/v4.23.0/web/src/hooks/use-application-chrome.ts),
[application update controller](https://github.com/casdoor/casdoor/blob/v4.23.0/controllers/application.go),
[application persistence](https://github.com/casdoor/casdoor/blob/v4.23.0/object/application.go),
[action responses](https://github.com/casdoor/casdoor/blob/v4.23.0/controllers/base.go), and
[pinned Xorm MustCols](https://github.com/xorm-io/xorm/blob/v1.1.6/internal/statements/statement.go).

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

### Disposable branding check

The normal Node gate skips the optional native-provider browser test. To run it,
copy `/server` and `/web/build` from an existing container of the pinned image.
`docker cp` reads those files without a container restart. Do not copy its identity
configuration, sessions, or database. Use explicit local paths:

```bash
CASDOOR_BRANDING_TEST_SERVER=/path/to/copied/server \
CASDOOR_BRANDING_TEST_BUILD=/path/to/copied/build \
  node --test auth/casdoor/branding.browser.test.mjs
```

The copied server is a static Linux executable. This test requires a compatible
Linux host, frontend Playwright dependencies, and Chromium. It creates fresh
identity state under the OS temporary directory and a random loopback port.
It neither reads live environment credentials nor starts a Docker network.
`TMPDIR=/tmp/opencode` selects the preferred OpenCode scratch directory.
The fixture stops its own process after the test. Scratch state remains private
for diagnostics. It never starts or stops an existing provider.

Checks cover the real sparse update, preserved client/security fields, cleared
background, idempotent apply, native login/signup, passkey-tab access, fonts,
keyboard focus, input-border contrast, and horizontal overflow. Viewports include 1280, 768, 375, and
320 pixels, each in light and dark modes. For manual visual review, the same
environment variables plus `node auth/casdoor/branding.fixture.mjs` create a
fresh branded fixture and print its URL and process ID. Stop that preview process
after review. Never point these variables at live identity state.

Before live use, check the real OIDC callback and signup return flow on the
approved HTTPS hostname. Also check password-manager autofill, screen-reader
labels/errors, 200% zoom, account/passkey management, and physical-device recovery.
The branding browser test does not verify browser password login, account creation,
credential registration, hardware passkeys, or email delivery.

### Revocation and recovery integration

Use a fresh initialized `CASDOOR_STATE_DIR` under repository `tmp/`. Set the
private back-channel target to `http://backend:8787/v1/auth/backchannel-logout`.
Stop the initializer's standalone project before the combined stack starts.
Set `FRONTEND_PORT` to the registered `APP_PUBLIC_URL` port. Use separate free
Casdoor, frontend, and backend ports. Compose 2.24.4 or newer supports `!override`.

```bash
export AUTH_TEST_DATA_DIR="$PWD/tmp/casdoor-lifecycle-app"
mkdir -m 700 "$AUTH_TEST_DATA_DIR"
export NET_WORTH_ESTIMATOR_DB="$AUTH_TEST_DATA_DIR/net-worth-estimator.db"
export COMPOSE_FILE="docker-compose.yml:auth/compose.casdoor.yml:auth/compose.test.yml"
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
