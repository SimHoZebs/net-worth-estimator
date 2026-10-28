# Development stack

`docker-compose.dev.yml` runs the production Dockerfiles and pinned Casdoor image
with isolated dev storage, loopback ports, and external sync disabled. Compose
owns the container lifecycle. It does not load the production Compose files.

Receipt extraction uses a local mock adapter with no cloud credentials or
external calls. Upload the [synthetic sample](../backend/internal/receipts/adapters/mock/testdata/market.png)
to a saved expense to exercise extraction. Other images support manual review.
See [receipt setup and source contracts](../docs/receipts.md). Production snapshots
and private plan refreshes now include receipt images and review data.

## One-time setup

Requires Docker Compose 5.0+ and Node 24+. The data commands use
[`docker compose start --wait`](https://github.com/docker/compose/blob/v5.0.0/cmd/compose/start.go).

```bash
./scripts/dev setup
```

Setup generates private credentials, initializes Casdoor, and takes a SQLite-safe,
read-only production snapshot. Use `setup --from /absolute/path/backup.db` instead
to start from an existing shared-schema backup. Fresh setup copies one selected
financial plan into the bootstrap dev account. It excludes production identity
records and other users' plans. It starts Casdoor only if identity initialization
is required. It does not start the API or frontend.

Database provisioning occurs in this explicit setup workflow. Daily API startup
requires the existing complete schema and never creates or repairs a database.

If the source contains several private plans, supply `--source-plan "$SOURCE_PLAN"`.
If the source contains exactly one private plan, setup selects it automatically.
For legacy files, use `setup --manifest /private/migration.json` with the
[explicit migration manifest](../docs/shared-database.md#manifest-version-1).
Setup migrates into a private intermediate before it copies the selected financial scope.

For an existing dev stack, run the same setup command once. It preserves saved
credentials, issuer URLs, plan ownership, financial data, and sessions. Legacy dev
databases require offline migration before setup can continue. Setup
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
database, stops the API for the scoped update, then starts the same API container.
It does not build images or change production data.

```bash
./scripts/dev refresh-db --plan "$TARGET_PLAN" --source-plan "$SOURCE_PLAN"
./scripts/dev refresh-db --plan "$TARGET_PLAN" --source-plan "$SOURCE_PLAN" --from /absolute/path/backup.db
./scripts/dev publish-sample --source-plan "$SOURCE_PLAN" --from /absolute/path/approved-snapshot.db
```

`refresh-db` backs up the shared application database under `tmp/dev/backups/`.
It replaces only the explicitly selected private plan. It preserves identities,
passkeys, application sessions, grants, logout records, and other accounts' plans.
`--from` selects a source for that operation. Plain Compose startup never refreshes data.

`publish-sample` publishes a snapshot as `plans/sample` in the shared application
database. Without `--from`, it reads the selected plan from the current dev database. Approve the exact
financial data before publication. The copy omits private projection history,
Bridge links, upstream sync keys, sync times, migration history, and the source
path. Later private edits do not change the sample.

Use verified resource IDs for `TARGET_PLAN` and `SOURCE_PLAN`. The source must
use the shared application schema. Migrate legacy backups first. The commands
require explicit selection because one source snapshot can contain several owners.

## Access and state

Casdoor grants access to each account's private plan. Signup needs no role choice
or manual grant. Guests can read and project only the separate sample. Account
controls appear above sidebar navigation.

One shared application database holds every private plan, the published sample,
and application sessions. The verified `ownerSubject` in `tmp/dev/config.json`
selects the account for server-level Bridge credentials. Dev keeps sync disabled.
Fresh setup assigns the bootstrap
account. Other accounts receive their own blank plan in the same database.

Back up `.env.dev` and `tmp/dev/` to retain the full dev state. Files use `0600`,
and private directories use `0700`. Compose `down` retains the bind-mounted data.
Existing Casdoor instances require the reviewed permission objects described in
[the authorization contract](../docs/authorization.md).

Legacy per-plan databases require [explicit offline migration](../docs/shared-database.md).
Back up every legacy source before migration. Runtime startup does not merge
files or infer ownership. Casdoor's external state remains separate from the
shared application database.

## Verification

The configuration tests use the Docker Compose CLI without a daemon:

```bash
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Destructive identity tests use separate disposable state, not the normal dev stack.
