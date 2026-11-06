# Development stack

`docker-compose.dev.yml` runs the production Dockerfiles and Better Auth on Bun
with isolated dev storage, loopback ports, and external sync disabled. Compose
owns the container lifecycle. It does not load the production Compose files.

Receipt extraction uses a local mock adapter with no cloud credentials or
external calls. Upload the [synthetic sample](../backend/internal/receipts/adapters/mock/testdata/market.png)
to a saved expense to exercise extraction. Other images support manual review.
See [receipt setup and source contracts](../docs/receipts.md). Production snapshots
and private user refreshes now include receipt images and review data.

## One-time setup

Requires Docker Compose 5.0+, Node 24+, and Bun 1.4.4. The data commands use
[`docker compose start --wait`](https://github.com/docker/compose/blob/v5.0.0/cmd/compose/start.go).

```bash
./scripts/dev setup
```

Setup generates private credentials, provisions Better Auth and Casbin, and snapshots the
stopped production database. Stop the production container first so the file
copies cleanly. Use `setup --from /absolute/path/backup.db` instead
to start from an existing shared-schema backup. Fresh setup copies the selected
financial data into the bootstrap dev user. It excludes production identity
records and other users. It provisions identity storage through Bun without
starting services. It does not start the API or frontend.

Database provisioning occurs in this explicit setup workflow. Daily API startup
requires the existing complete schema and never creates or repairs a database.

If the source contains several private users, supply `--source-user "$SOURCE_USER"`.
If the source contains exactly one private user, setup selects it automatically.

For an existing Better Auth dev stack, run the same setup command once. It preserves saved
credentials, issuer URLs, user ownership, financial data, and sessions. If the dev
database is incompatible, delete the dev database and run setup again. Setup
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

The local frontend is **http://localhost:5178**. Better Auth uses **8000**, and the API
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
It does not build images or change production data. Without --from, the source
is the production container: stop it first so the file copies cleanly.

```bash
./scripts/dev refresh-db --user "$TARGET_USER" --source-user "$SOURCE_USER"
./scripts/dev refresh-db --user "$TARGET_USER" --source-user "$SOURCE_USER" --from /absolute/path/backup.db
./scripts/dev publish-sample --user "$GUEST_USER" --source-user "$SOURCE_USER" --from /absolute/path/approved-snapshot.db
./scripts/dev seed --bulk 20x200:7
./scripts/dev seed --clear
./scripts/dev demo --pack safe-spending
./scripts/dev demo --pack safe-spending-shortfall
```

`refresh-db` backs up the shared application database under `tmp/dev/backups/`.
It replaces only the explicitly selected private user. It preserves identities,
passkeys, application sessions, grants, logout records, and other users.
`--from` selects a source for that operation. Plain Compose startup never refreshes data.

`seed` injects tagged synthetic accounts beside the existing dev data
(`--bulk NxM[:seed]`, for example `20x200:7`) and `seed --clear` removes
only those tagged rows. Real rows stay untouched; the prior database is
backed up under `tmp/dev/backups/` first. The default target is the
bootstrap dev owner; pass `--user users/<64hex>` for another scope.

`demo` starts the browser fixture API and Vite on isolated ports with a
throwaway database, loads the named fixture pack, sets the browser clock to
the pack's anchor date, and opens a headed browser. It never touches the
dev stack or the owner's data. Stop it with Ctrl-C. The same pack feeds the
browser suite, so the demo and the tests share one seed sequence. The
`safe-spending` pack shows the card spending thresholds and pace chart; the
`safe-spending-shortfall` pack shows an unfulfilled recurring bill.
Automated smoke checks may set `DEMO_HEADLESS=1` and
`DEMO_EXIT_AFTER_MS=<ms>`; normal use is headed and waits for Ctrl-C.

`publish-sample` keeps its name but publishes into the provisioned guest scope
(`--user users/<guest-hash>`, never a sample wire). Without `--from`, it reads
the selected user from the current dev database. Approve the exact
financial data before publication. The `--financial-only` copy omits receipts,
private projection history, Bridge links and credentials, upstream sync keys
and mappings, sync times, migration history, private defaults, and the source
path. The guest destination row must already exist (setup provisions it via
`setupdb --db PATH --issuer ISSUER --subject GUEST_SUBJECT`). Later private
edits do not change the published guest scope.

Use verified resource IDs for `TARGET_USER` and `SOURCE_USER`. The source must
use the shared application schema. The commands
require explicit selection because one source snapshot can contain several owners.

## Access and state

Casbin grants access to each user's private data. Signup needs no role choice
or manual grant. First verified access records member assignment. Explicit setup
assigns viewer to the provisioned guest.
Account controls appear above sidebar navigation.

Stable interactive login: the bootstrap owner signs in with its Better Auth
username and the password recorded in `tmp/dev/config.json`
(`AUTH_USER_PASSWORD`, file mode `0600`). Setup preserves that
password across re-runs — it is the reusable dev credential, never
committed anywhere.

One shared application database holds every private user, the published guest
scope, and application sessions. The verified `guestSubject` in
`tmp/dev/config.json` selects the provisioned guest for anonymous traffic.
SimpleFIN credentials live in each user's own rows and every user with a key
can sync it. Dev
keeps sync disabled.
Fresh setup assigns the bootstrap
user and provisions the guest destination row. Other users receive their own blank private workspace in the same database.

Back up `.env.dev` and `tmp/dev/` to retain the full dev state. Files use `0600`,
and private directories use `0700`. Compose `down` retains the bind-mounted data.
Existing installations require the reviewed policy assignments described in
[the authorization contract](../docs/authorization.md).

Runtime startup does not merge
files or infer ownership. Better Auth's external state remains separate from the
shared application database.

## Verification

The configuration tests use the Docker Compose CLI without a daemon:

```bash
node --test dev/*.test.mjs
bun --filter @waypoint/auth test
```

Destructive identity tests use separate disposable state, not the normal dev stack.
