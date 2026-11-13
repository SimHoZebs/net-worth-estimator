# Northflank Sandbox deployment

Co-locating Go and River is a **Northflank Sandbox deployment decision**, not a
feature requirement. The application depends only on the judgment provider
contract. Other deployments can use the default Go-only image and any compatible
separate provider at `ML_JUDGMENT_URL`, or omit it for deterministic analysis.

The explicit `northflank` target in `backend/Dockerfile` is published as
`ghcr.io/simhozebs/net-worth-estimator-backend-northflank:sha-<commit>`. It adds Python, River, and
a small process supervisor. River runs on loopback port 8766, the API runs on its
public port, and the supervisor waits for River storage readiness before booting
the API. A child exit stops both processes, and SIGTERM is forwarded with a
bounded shutdown grace period.

Use `python /app/northflank-runtime.py` as the API service's custom command.
The supervisor runs `/app/api-boot.sh` after the ML provider is healthy, and
that wrapper provisions or validates the shared application database before
`/app/server`. The release maintenance command must bypass the supervisor so all
API writers stop before the offline migration, and the Northflank command is
restored only after a successful migration. Do not change the identity provider
or issuer as part of adopting this packaging.

The existing API volume holds three current application databases whose paths
come from the service environment:

- `$NET_WORTH_ESTIMATOR_DB` (live `/data/waypoint.db`): owner-scoped evidence and
  feedback audit.
- `$NET_WORTH_ESTIMATOR_AUTHZ_DB` (live `/data/authorization.db`): embedded
  Casbin policy assignments and rules.
- `$ML_MODEL_PATH` (live `/data/ml-v2.sqlite3`): River learner, deduplication
  receipts, and owner cursors.

The volume also retains older files from earlier revisions, including
`/data/net-worth-estimator.db` and `/data/ml.sqlite3`. They are not live.
Backup, verification, and restore must use the environment variables rather
than those names.

Provision the policy database once before the first API start. The server fails
closed when the policy database is missing, and `api-boot.sh` does not create it:

```bash
/app/authzctl --setup --db "$NET_WORTH_ESTIMATOR_AUTHZ_DB" \
  --issuer "$NET_WORTH_ESTIMATOR_AUTH_ISSUER" \
  --guest "$NET_WORTH_ESTIMATOR_GUEST_SUBJECT"
```

No extra service, database addon, volume, GPU, or external model subscription is
needed. Keep the existing single API instance and `nf-compute-10` allocation
(0.1 vCPU, 256 MiB). BLAS threading is limited to one and Go's soft memory target
is 96 MiB in this target only. Measure the combined workload under those limits;
a successful image build does not prove capacity. The constrained image test
exercises startup, feedback, duplicate delivery, provider failure, persisted
restart, and graceful shutdown at those limits.

River commits model and delivery state atomically. Back up persistent storage with SQLite's backup API; the application migration backup does not include the River database, and no automatic volume snapshot is assumed.

## Release webhook

At installation, replace `INJECT_PRIVATE_WEBHOOK_TOKEN` in `release.json`
with a new private token and keep that value when applying later definition
updates. Save the resulting webhook URL as the GitHub Actions secret through
standard input, never command arguments, and never commit the token or URL.
Northflank accepts `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` in the
URL query, not a POST body. `RELEASE_SHA` is recorded for identification;
the image references drive the deployment.

## Release window and recovery

The release stops every API writer, swaps the API container for a maintenance
process that answers `/readyz` with `maintenance`, migrates the real database,
and restores the API command only after the migration exits zero. The release
waits for the API container to be running before it migrates, because the
migration runs inside that container. The identity image deploy runs after the
API image deploy, so the API container is already settled when the migration
attaches to it.

Northflank can still refuse that command with `No running container found`
when the container was replaced moments earlier. The migration never mutates
the database before it publishes, so a refused command leaves the API in
maintenance with the database unchanged. Request the release again. A GitHub
manual dispatch of the release workflow requests the current `main` commit and
its published images, so use it while `main` still points at the failed commit.
To release the failed target exactly, run the workflow from the Northflank UI
or API with `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` overridden to
that target's values, as [the migration SOP](../MIGRATIONS.md) describes. A
release that fails after the migration published must release that same
reviewed target, or a newer commit that contains that migration, and never
older code. A second release queues behind the first and never overlaps it.

The policy for a failed release lives in [the migration SOP](../MIGRATIONS.md):
inspect the failed stage, repair and retry the same reviewed target, and never
promote old code over partial changes. A failed step leaves the API stopped or
in maintenance. When the API is in maintenance, recovering the window takes
these steps.

1. Wait until `/readyz` answers `maintenance`. That answer shows the
   maintenance container is serving. If the migration command is refused again
   with `No running container found`, wait for that answer and run it again.
   When nothing serves `/readyz`, the container is not up; request the release
   again instead of running the migration.
2. Run the migration as the API user and require exit zero.
3. Restore the API process command. The patch changes only the command and
   leaves credentials, ports, volumes, and identity settings untouched.

```bash
northflank exec service --project net-worth --service nwe-api --user 10001 --group 10001 \
  --shell-cmd 'sh -c' --cmd 'test -f "$NET_WORTH_ESTIMATOR_DB" && exec /app/migrate.sh'
northflank patch service combined --project net-worth --service nwe-api \
  -i '{"deployment":{"instances":1,"docker":{"configType":"customCommand","customCommand":"python /app/northflank-runtime.py"}}}'
```

`--shell-cmd 'sh -c'` runs the command through the container shell, so
`$NET_WORTH_ESTIMATOR_DB` expands inside the container rather than locally.
Confirm `/readyz` answers `ok` and never `maintenance` afterwards. A release
that fails after the API was stopped still requires a full green release of the
reviewed target before it is complete.
