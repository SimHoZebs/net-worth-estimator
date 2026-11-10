# Development stack

`docker-compose.dev.yml` runs the production Dockerfiles and Better Auth on Bun with isolated dev storage, loopback ports, and external sync disabled. Compose owns the container lifecycle and does not load the production Compose files. Receipt extraction uses a local mock adapter with no cloud credentials; upload the synthetic sample at `backend/internal/receipts/adapters/mock/testdata/market.png` to a saved expense to exercise it.

## One-time setup

Requires Docker Compose 5.0+, Node 24+, and Bun 1.4.4.

```bash
./dev/main.mjs setup
```

Setup generates private credentials, provisions Better Auth and Casbin, and snapshots the stopped production database; stop the production container first so the file copies cleanly. Use `setup --from /absolute/path/backup.db` for an existing shared-schema backup and `--source-user "$SOURCE_USER"` when the source has several private users. Setup copies the selected financial data into the bootstrap dev user, excludes production identity records and other users, and does not start the API or frontend. Daily startup requires the existing complete schema and never creates or repairs a database.

For an existing dev stack, run the same command once: it preserves saved credentials, issuer URLs, user ownership, financial data, and sessions. If the dev database is incompatible, delete it and run setup again. Setup exports runtime settings to the ignored `.env.dev` and refuses to overwrite one whose settings differ. `tmp/dev/config.json` retains setup credentials and the snapshot source; both are private.

## Daily commands

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
docker compose --env-file .env.dev -f docker-compose.dev.yml ps
docker compose --env-file .env.dev -f docker-compose.dev.yml logs -f backend
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --no-build --pull never --wait
```

The local frontend is **http://localhost:5178**, Better Auth uses **8000**, and the API debug port is **8788**. All ports bind to loopback. The project name remains `waypoint-dev`, so existing containers and storage stay in the same stack. The explicit `-f` overrides `COMPOSE_FILE`, and this stack defines no optional profiles. Compose does not replace financial data or generate credentials on startup.

## Tailnet access

Remote browsers require HTTPS. An operator configures these tailnet-only routes once from a privileged terminal:

```bash
sudo tailscale serve --bg --https=5178 http://127.0.0.1:5178
sudo tailscale serve --bg --https=8000 http://127.0.0.1:8000
```

For a new dev identity, run `./dev/main.mjs setup --tailnet`. Setup checks the routes without changing them and prints the HTTPS frontend and issuer URLs. Never reset shared Serve settings or switch an existing issuer to another origin without an explicit identity migration.

## Explicit data operations

Start the stack before these operations. Each command validates the incoming database, stops the API for the scoped update, then starts the same API container. `refresh-db` reads the configured snapshot source by default; stop the production container first so the file copies cleanly. `publish-sample` reads the current dev database by default.

```bash
./dev/main.mjs refresh-db --user "$TARGET_USER" --source-user "$SOURCE_USER"
./dev/main.mjs refresh-db --user "$TARGET_USER" --source-user "$SOURCE_USER" --from /absolute/path/backup.db
./dev/main.mjs publish-sample --user "$GUEST_USER" --source-user "$SOURCE_USER" --from /absolute/path/approved-snapshot.db
./dev/main.mjs seed --bulk 20x200:7
./dev/main.mjs seed --clear
./dev/main.mjs demo --pack safe-spending
./dev/main.mjs demo --pack safe-spending-shortfall
```

`refresh-db` backs up the shared application database under `tmp/dev/backups/` and replaces only the selected private user, preserving identities, passkeys, sessions, grants, logout records, and other users. `seed` injects tagged synthetic accounts beside existing dev data and `seed --clear` removes only those rows; real rows stay untouched and the prior database is backed up first. The default target is the bootstrap dev owner; pass `--user users/<64hex>` for another scope. `demo` starts the browser fixture API and Vite on isolated ports with a throwaway database and the named fixture pack; stop it with Ctrl-C. Automated checks may set `DEMO_HEADLESS=1` and `DEMO_EXIT_AFTER_MS=<ms>`. `publish-sample` publishes into the provisioned guest scope, never a sample wire; approve the exact financial data first, and use `--financial-only` to omit receipts, private projection history, Bridge links and credentials, sync keys and mappings, sync times, migration history, private defaults, and the source path.

Use verified resource IDs for `TARGET_USER` and `SOURCE_USER`. The source must use the shared application schema, and the commands require explicit selection because one source snapshot can contain several owners.

## Access and state

Casbin grants access to each user's private data. Signup needs no role choice or manual grant; first verified access records member assignment, and explicit setup assigns viewer to the provisioned guest. Disposable development fixtures use the password recorded in `tmp/dev/config.json` (`TEST_AUTH_USER_PASSWORD`, file mode `0600`), which setup preserves across re-runs.

One shared application database holds every private user, the published guest scope, and application sessions. The verified `guestSubject` in `tmp/dev/config.json` selects the provisioned guest for anonymous traffic. Dev keeps SimpleFIN sync disabled. Back up `.env.dev` and `tmp/dev/` to retain the full dev state; files use `0600` and private directories use `0700`. Fresh setup assigns viewer to the provisioned guest and records member assignment on first verified access with no manual grant step.

## Run from source

For low-level source debugging, run the API and Vite separately; normal manual testing uses the dev stack above, and both frontends cannot use port 5178 at the same time. Copy a database backup to the dev database path while the server is stopped; `tmp/` is gitignored and survives reboot.

```bash
# terminal 1
cp <backup>.db tmp/net-worth-estimator.db
NET_WORTH_ESTIMATOR_DB=$PWD/tmp/net-worth-estimator.db \
CGO_ENABLED=0 go -C backend run ./cmd/server

# terminal 2
bun install --frozen-lockfile
bun --filter ./frontend dev
```

The Vite server runs on http://localhost:5178 and proxies `/v1` to `127.0.0.1:8787`.

## Verification

The configuration tests use the Docker Compose CLI without a daemon:

```bash
node --test dev/*.test.mjs
bun --filter @waypoint/auth test
```

Destructive identity tests use separate disposable state, not the normal dev stack.
