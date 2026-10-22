# Development stack

`docker-compose.dev.yml` runs the production Dockerfiles and pinned Casdoor image
with isolated dev storage, loopback ports, and external sync disabled. Compose
owns the container lifecycle. It does not load the production Compose files.

## One-time setup

Requires Docker Compose 5.0+ and Node 24+. The data commands use
[`docker compose start --wait`](https://github.com/docker/compose/blob/v5.0.0/cmd/compose/start.go).

```bash
./scripts/dev setup
```

Setup generates private credentials, initializes Casdoor, and takes a SQLite-safe,
read-only production snapshot. Use `setup --from /absolute/path/backup.db` instead
to start from an existing backup. It starts Casdoor only if identity initialization
is required. It does not start the API or frontend.

For an existing dev stack, run the same setup command once. It preserves saved
credentials, issuer URLs, primary ownership, financial data, and sessions. It
exports runtime settings to the ignored `.env.dev` file without restarting services.

`tmp/dev/config.json` retains setup credentials and the snapshot source. `.env.dev`
contains only the runtime settings Compose needs. Both are private. Setup refuses
to overwrite a different `.env.dev`. Preserve and reconcile any edits before retry.

## Daily commands

Run from the repository root:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
docker compose --env-file .env.dev -f docker-compose.dev.yml ps
docker compose --env-file .env.dev -f docker-compose.dev.yml logs -f backend
```

To reuse existing images without builds or registry pulls:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --no-build --pull never --wait
```

The local frontend is **http://localhost:5178**. Casdoor uses **8000**, and the API
debug port is **8788**. All ports bind to loopback. The project name remains
`waypoint-dev`, so existing containers and storage remain part of the same stack.
Compose does not replace financial data or generate credentials on startup.
The explicit `-f` overrides `COMPOSE_FILE`. This stack defines no optional profiles,
so inherited `COMPOSE_PROFILES` does not change its services.

## Tailnet access

Remote browsers require HTTPS. An operator must configure these tailnet-only
routes once from a privileged terminal:

```bash
sudo tailscale serve --bg --https=5178 http://127.0.0.1:5178
sudo tailscale serve --bg --https=8000 http://127.0.0.1:8000
```

For a new dev identity, run `./scripts/dev setup --tailnet`. Setup checks the routes
without changing them and prints the HTTPS frontend and issuer URLs. Daily Compose
commands stay the same. Existing saved HTTPS origins remain unchanged when setup
runs without flags. Never reset shared Serve settings or switch an existing issuer
to another origin without an explicit identity migration.

## Explicit data operations

Start the stack before these operations. Each command validates the incoming
database, stops the API for replacement, then starts the same API container.
It does not build images or change production data.

```bash
./scripts/dev refresh-db
./scripts/dev refresh-db --from /absolute/path/backup.db
./scripts/dev publish-sample --from /absolute/path/approved-snapshot.db
```

`refresh-db` backs up the prior primary database under `tmp/dev/backups/`. It
preserves identities, passkeys, sessions, and other accounts' plans. `--from`
changes the saved refresh source. Plain Compose startup never refreshes data.

`publish-sample` publishes a separate snapshot for guests. Without `--from`, it
copies the current dev primary plan. Approve the exact financial data before
publication. The copy omits private projection history, Bridge links, sync times,
and the source path. Later private edits do not change the sample.

## Access and state

Casdoor grants access to each account's private plan. Signup needs no role choice
or manual grant. Guests can read and project only the separate sample. Account
controls appear above sidebar navigation.

The primary database belongs to the verified `ownerSubject` in `tmp/dev/config.json`.
Fresh setup assigns the bootstrap account. Existing setups require an explicit
owner assignment. Other accounts start empty under `tmp/dev/data/plans/`.

Back up `.env.dev` and `tmp/dev/` to retain the full dev state. Files use `0600`,
and private directories use `0700`. Compose `down` retains the bind-mounted data.
Existing Casdoor instances require the reviewed permission objects described in
[the authorization contract](../docs/authorization.md).

The API upgrades older posting IDs to UUIDs on first open. Back up all financial
databases before a schema update. See [the posting migration contract](../docs/posting-identity.md)
for reference preservation and rollback. Identity state remains separate.

## Verification

The configuration tests use the Docker Compose CLI without a daemon:

```bash
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Destructive identity tests use separate disposable state, not the normal dev stack.
