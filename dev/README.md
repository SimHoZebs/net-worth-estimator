# Repeatable development stack

Run the same Go API image, Nginx frontend image, Casdoor image, and Compose wiring
as production. The dev override changes only local ports, isolated data mounts,
the non-root bind-mount user, and external-sync settings. It does not use Vite
or a fixture API.

Requires Docker Compose 2.24.4+ and Node 24+.

```bash
./scripts/dev up
```

Open **http://localhost:5178**. Casdoor runs on **8000**. The API debug port is
**8788**. All three ports bind to loopback. The command fails on occupied ports
instead of selecting another port or attaching to an unrelated process.

On first use, `up` takes a SQLite-safe snapshot from the local production
container named `net-worth-estimator`. A one-shot helper mounts production
volumes **read-only**, has no network or Linux capabilities, and runs as the
database's non-root owner. Production remains online. Only the financial database
is copied. Production authentication credentials and sessions are not copied.
The helper uses a 512 MiB temporary filesystem. For larger databases or another
deployment, supply an existing SQLite backup instead:

```bash
./scripts/dev up --from /absolute/path/production-backup.db
```

The command generates private dev identity configuration once. It initializes
Casdoor in the same Compose project, records its generated subject, and starts
the API/frontend after the identity service is ready. Further `up` calls reuse
data, accounts, signing keys, passkeys, grants, and sessions. Image builds use
Docker's cache. Source changes reach the browser through the production build.

## Daily commands

```bash
./scripts/dev up           # build/start or update the stack
./scripts/dev down         # stop/remove containers, retain all local state
./scripts/dev status
./scripts/dev logs backend
./scripts/dev refresh-db   # replace dev financial data from a fresh prod snapshot
```

`refresh-db` validates the new snapshot before it stops the dev API. It backs up
the prior dev database under `tmp/dev/backups/`, replaces financial data, and
restarts the API. Identity data stays unchanged. A failed replacement restarts
the prior API database. `refresh-db --from /path/backup.db` changes the saved
source to that backup file. Plain `up` never replaces an existing dev database.

SimpleFIN and mock sync remain disabled in dev, including after a production
database refresh. Dev writes change only the private dev copy. No command stops,
reconfigures, or writes to production containers or volumes.

## Login and access

Anonymous visits redirect to Casdoor. Use `sign up now` to create your dev account.
Copy the verified subject from the access-pending screen, then grant it access:

```bash
./scripts/dev grant VERIFIED_SUBJECT editor
```

Use `reader` for read-only access. Signup never grants financial access. The
initializer's separate ordinary `household` account receives the initial editor
grant. Its password and the Casdoor administrator password stay in private
`tmp/dev/config.json`. Keep the administrator credential in a password manager.

## State and verification

All dev state lives in gitignored `tmp/dev/`. Directories use `0700`. Credentials
and database snapshots use `0600`. Preserve this directory to retain dev logins.
`down` never deletes it. A new checkout can create a fresh stack with `up`.
Run one lifecycle command at a time. A process lock rejects overlap and recovers
automatically after a terminated command.

```bash
node --test dev/*.test.mjs auth/casdoor/*.test.mjs
```

Automated destructive recovery tests still use their own isolated state. They
do not replace this normal manual-development stack.
