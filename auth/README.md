# Local authentication with Casdoor

Casdoor owns passwords, passkeys, and local SQLite identities. The Go API owns
OpenID Connect (OIDC) verification, persistent application sessions, and plan access.
The Better Auth comparison and resource benchmarks remain on `experiment/better-auth`.

## Start the split stack

Follow [the Casdoor initializer](casdoor/README.md) to create a private environment
file and initialize one normal user. Select the final public hostnames before
passkey enrollment. Use `APP_PUBLIC_URL=http://localhost:8080` for local Compose.
Set `CASDOOR_BACKCHANNEL_LOGOUT_URL=http://backend:8787/v1/auth/backchannel-logout`
for signed logout notifications through the private container network.

Run these commands from the repository root after initialization:

```bash
docker compose --env-file auth/casdoor/.env \
  -f auth/casdoor/compose.yml -p waypoint-casdoor down
export CASDOOR_STATE_DIR="$PWD/auth/casdoor/data"
export COMPOSE_FILE="docker-compose.yml:auth/compose.casdoor.yml"
export NET_WORTH_ESTIMATOR_AUTH_EDITORS="$(
  node --input-type=module -e \
    'import {readFileSync} from "node:fs"; process.stdout.write(JSON.parse(readFileSync(process.env.CASDOOR_STATE_DIR + "/bootstrap.json", "utf8")).subject)'
)"
docker compose --env-file auth/casdoor/.env up -d --build
```

If initialization uses another project or state directory, use those same values.
Never run two Casdoor processes against one SQLite directory. Keep the verified
subject grant in private deployment configuration. Remove the legacy
`NET_WORTH_ESTIMATOR_AUTH_TOKEN` in Casdoor mode.

The overlay routes server requests to `http://casdoor:8000` while preserving the
public issuer and Host. The browser uses the public Casdoor URL. The frontend and
API must share one public origin. Set `FRONTEND_PORT` to match `APP_PUBLIC_URL`.
Use an empty `VITE_API_BASE_URL` for the frontend proxy.

The base stack retains the existing `net-worth-estimator-data` financial volume.
A different project name alone does **not** isolate that explicitly named volume.
Override its name or use a separate bind mount for disposable tests.

## Session and access contract

- Anonymous application visits redirect directly to Casdoor's sign-in page.
  Its account-creation link creates ordinary identities, not financial grants.
- Login grants no plan access. Assign verified subjects to reader/editor lists.
- Readers can read and compute projections. Editors can also save changes.
- Provider administrator status never grants financial access.
- Application sessions persist across browser and API restarts, with a seven-day
  absolute limit by default. Managed refresh grants renew short-lived tokens.
- Signed back-channel logout deletes application grants. Token introspection
  checks administrator revocation on the next request after 30 seconds by default.
- Provider outages fail closed with 503 when a check is due. A later retry can
  recover without a new login if the grant remains active.

See [the authentication contract](../docs/authentication.md) for configuration,
revocation bounds, recovery, backups, and current scope.

## Normal local development

Use `./scripts/dev up`, then open **http://localhost:5178**. This uses the same
Compose files, Go image, Nginx image, Casdoor image, and private-network OIDC
routing as production. Dev data and credentials stay under `tmp/dev/`.
`./scripts/dev down` retains them. `./scripts/dev refresh-db` replaces only
financial data from a safe production snapshot. See [the dev guide](../dev/README.md).

Automated tests below use isolated data because they reset passwords, revoke
sessions, and change client settings. They do not replace the normal dev setup.

## Verification

```bash
node --test auth/casdoor/*.test.mjs
node --env-file=auth/casdoor/.env auth/casdoor/smoke.mjs
```

Use disposable identity state for browser tests. The smoke test adds a virtual
passkey and verifies real Casdoor UI login, OIDC claims, remembered sessions,
logout, and PKCE rejection. Set `CASDOOR_RESTART_CONTAINER` to the explicit test
container name to verify restart persistence. The smoke test owns an unused
loopback HTTP application callback port. Stop the app before that test.

For the Go/browser contract, register an unused loopback application port in
`APP_PUBLIC_URL`. Leave that port free. Build the frontend, set the backend OIDC
environment from the contract, then supply:

```text
AUTH_TEST_SUBJECT=<subject from private bootstrap.json>
AUTH_TEST_USERNAME=<CASDOOR_USER_NAME>
AUTH_TEST_PASSWORD=<CASDOOR_USER_PASSWORD>
```

```bash
node auth/test-integration.mjs
```

The script owns a temporary financial database and browser profile under
gitignored `tmp/`. It verifies editor/viewer grants, CSRF, restart persistence,
projections, grant removal, logout, and captured-cookie rejection. It refuses an
occupied application port. Retained browser profiles contain credentials.

Physical phone passkeys and security keys require the manual checklist in the
contract. A virtual authenticator does not verify physical-device behavior.
For administrator revocation, token refresh, recovery, and private-network
signed logout, use [the disposable lifecycle stack](casdoor/README.md#revocation-and-recovery-integration).
