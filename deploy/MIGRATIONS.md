# Migration SOP for every deployment

## One contract

`deploy/migrate.sh` is the single replaceable migration body. The API image
contains it at `/app/migrate.sh`. Deployment adapters run it from the **target
image**, with its normal environment, non-root user, and actual data mount.
A nonzero exit prevents API startup. The server never invokes this script.

Keep one-time SQL and provider edits in this file. Do not add a migration
registry, numbered chain, or historical-model converter to the backend.
Use existing `setupdb`, `refreshmodel`, and `importcsv` tools where appropriate.
The image also provides `sqlite3` for offline SQL and SQLite-safe backups.

The current body performs one combined offline upgrade. It converts the
deployed user-scoped date-only checkpoints to exact UTC day-close instants
and enables legacy settled bank rows with their posted event time, then
provisions the Analysis evidence, findings, and feedback schema from frozen SQL
in `analysis-schema.sql`. It then runs the independent
`/app/upgrade-planned-purchases` tool to convert retired purchase policies.
Conversion and repair run inside a candidate copy of a verified backup;
`setupdb` only validates the complete current schema on that candidate. A logical
database digest proves that validation changes no schema or rows. Only the verified
candidate is published over the original database, so the original file is
never mutated before publication. It accepts current `shared-accounts-v1`
storage with date-only or final checkpoints, zero or all Analysis tables, and
either the retired or standalone purchase shape. Complete targets repeat read-only.
Mixed purchase shapes and partial application or
Analysis schemas fail before any backup. It checks integrity and foreign
keys, creates a private `<database>.analysis-backup.XXXXXX/before.db` with
the SQLite backup API, and compares every preexisting application table,
except the schema-marker table, against that backup. Only the checkpoint
date-to-instant conversion, settled-bank repair, and explicit purchase-row
conversion may differ. Purchase conversion preserves all other rows, identities,
and Analysis evidence. Unsafe purchase inputs leave the original unchanged. A
complete target repeat performs read-only checks only and never reactivates
a post-upgrade owner disable.

The old import default and pre-upgrade API-set exclusions share the same
disabled flag. The conversion enables all legacy settled bank rows once,
including those API exclusions. Later exclusions remain intact on retries.

The adapter must keep every API writer stopped for the complete operation.
Failed conversion, setup, or postconditions leave the original database
byte-identical with the verified backup retained; no automatic rollback
resumes the API and this body never restores over the data file. The private
`<database>.analysis-migration-pending` file from an actual previous attempt
is recognized fail-closed. Retain this body until both supported targets
verify it. No provider edits belong to this migration.

`render-free-boot.sh` provisions current schema and the ordinary guest row on
hosts configured for that command. This is fresh/current storage provisioning,
not the deployment migration hook. Keep the two separate.

## Supported execution paths

| Target | Adapter | Storage access and gate |
| --- | --- | --- |
| Home-server Komodo | Infrastructure `net-worth-estimator/migrate.sh` | Build target images, stop frontend/API, run `/app/migrate.sh` with `net-worth-data`; continue Compose only on exit 0. |
| Northflank | `northflank/release.json` and `northflank/api-command.json` | Build pinned images, back up identity, replace API with a maintenance process on its existing volume, run `/app/migrate.sh`, restore API command only on success. |
| Other container hosts | Explicit stopped-API maintenance operation | Run the same image command with the real disk attached. A job without that disk does not migrate production. |

Vercel contains no financial database and needs no database migration hook.
Render disks are unavailable to pre-deploy jobs. Use [explicit disk maintenance](README.md#explicit-disk-maintenance-on-render).
A new host is covered only after its adapter passes failure and storage checks.
Do not infer coverage from a successful build.

## 1. Prepare and review

1. List every target, current app SHA, database schema, and identity version.
2. Inspect actual mounts. Preserve issuer, subjects, credentials, keys, and ownership.
3. Define exact source and target states. Reject unknown or partial states before mutation.
4. Define retry behavior from actual data. Never reset existing users on retry.
5. Define rollback and the point after which new writes require reconciliation.
6. Replace `deploy/migrate.sh`. Keep platform orchestration outside the body.
7. Rehearse with disposable state, including failure, retry, and repeat success.
8. Verify migration and API use the same immutable target image.
9. Run affected tests, image checks, shell syntax, and adapter contract checks.
10. Review the exact staged diff before the semantic commit and push.

Run `node --test deploy/analysis-migration.test.mjs deploy/migrations.test.mjs`
for the current body's preflight, backup, row-preservation, failure, retry, and
repeat checks. These local checks need Go and SQLite CLI, not live credentials.

SQL conversion and provider-policy updates use the same path. Their bodies
differ; their deployment contract does not. Pass target-specific values through
private runtime settings. Do not embed host paths or provider names in the body.
Keep credentials out of Git, command arguments, workflow arguments, and logs.

## 2. Open the maintenance window

1. Record and pause deploy triggers. Check active builds, deploys, syncs, and backups.
2. Disable paths that bypass the adapter before pushing a pending migration.
3. Pin the reviewed app SHA. Build before stopping services where possible.
4. Stop every API writer, including its scheduler. Keep one SQLite writer only.
5. Confirm the maintenance process has the original data mount.

For provider edits, stop applicable provider writers or use a documented
provider-consistent backup and mutation procedure. A financial backup is not an
identity backup. Preserve provider credentials, signing keys, config, subjects,
and sessions required for paired recovery.

## 3. Back up, execute, and verify

1. Create a new private backup set. Never overwrite it on retry.
2. Use SQLite's backup API or `sqlite3 .backup`. Never copy an active database file alone.
3. Verify restored backup integrity and foreign keys before production mutation.
4. Record backup hashes, source/target SHAs, target name, and deployment/workflow run ID.
5. Run `/app/migrate.sh` with the API stopped and the real database mounted.
6. Require exit 0 and explicit postconditions before allowing API startup.
7. Compare preserved identities and private rows with the backup.
8. Verify exact images, readiness, login/logout, permissions, isolation, and persistence.

For an API contract change, hold Vercel production builds until Northflank
passes the migration and API checks. Save the project's ignored-build command
before the hold. Preview builds can continue. Restore the saved command only
after the new API contract is live, then deploy the matching frontend SHA.

Require exactly `ok` from `PRAGMA integrity_check` and no rows from
`PRAGMA foreign_key_check`. A candidate database permits checks before
publication. Keep backup paths private and preserve numeric ownership.

On failure, the adapter leaves the API stopped or in maintenance. Inspect the
failed stage. Repair and retry the same reviewed target or perform paired
restore. Never automatically resume old code against partial changes.
After new writes, restore an older backup only after an explicit reconciliation
or accepted-data-loss decision. Infrastructure rollback cannot undo data.

## 4. Complete every target before retiring the body

Keep one release checklist with deployment evidence:

| Target | Source/target SHA | Backup/restore checks | Migration/deployment run ID | Runtime checks | Result |
| --- | --- | --- | --- | --- | --- |
| Komodo | Record | Record | Record | Record | Pending/pass/fail |
| Northflank | Record | Record | Record | Record | Pending/pass/fail |

1. Keep the body until every supported target passes its postconditions.
2. Resolve failed or offline targets before declaring the release complete.
3. Replace the completed body with a no-op in a separate reviewed commit.
4. Keep the executed body and rehearsal tests in Git history.
5. Deploy and verify the retired body on each target.
6. Restore recorded triggers through the gated adapters. Read them back.

Do not retire a migration after only one host succeeds. A delayed target still
needs that image's migration. Retain its exact image and recovery set.

## Northflank adapter

The files in `northflank/` define the `waypoint-release` workflow and small
`waypoint-api-command` template. The template changes only the API process
command and waits for its service. It does not change credentials, ports, volume
attachments, or identity settings.

Use workflow concurrency `queue` so releases never overlap or drop newer commits.
Disable per-service CI/CD bypasses: disable direct Git CI and pin both services
to built commits, not `latest`. For a manual **Northflank UI/API** run, override
`RELEASE_SHA` with a full reviewed commit. GitHub's manual dispatch instead
requests the current `main` commit. Builds stay sequential: one at a time.

`.github/workflows/northflank-release.yml` requests the workflow with the pushed
commit SHA. It has no GitHub token permissions or Northflank API credential.
Its `NORTHFLANK_RELEASE_WEBHOOK` repository secret can only request workflow runs.
The GitHub job confirms dispatch, not production completion. Check the Northflank
run separately. This adapter does not depend on Northflank's native Git webhook
registration, which currently cannot access this repository through its Git link.

At installation, replace `INJECT_PRIVATE_WEBHOOK_TOKEN` with a new private token.
Keep that value when applying later definition updates. Save the resulting
webhook URL as the GitHub Actions secret through standard input, never command
arguments. Northflank accepts `RELEASE_SHA` in the URL query, not a POST body.
Never commit the token or URL. Pause this trigger during a migration window.

The ReadWriteOnce volume stays attached to its one API service. Northflank
terminates the old pod before starting another pod with that volume. The
maintenance process serves only `/tmp/waypoint-maintenance`, never `/data`.
The API and scheduler are absent. Its `/readyz` body says `maintenance`, not
`ok`. The workflow deploys the target image and runs `/app/migrate.sh` as
UID/GID `10001`, with `dispatchOnly: false` to wait for its exit status.
Only success restores `/app/render-free-boot.sh` and waits for service health.

Postgres dumps precede identity-image replacement. They do not back up SQLite.
A pending migration must take and verify the financial backup in its shared
body before data edits. Volume snapshots are a separate account capability,
not a prerequisite for SQLite's backup operation.

Reapply reviewed JSON through the Northflank API when definitions change.
Read back the workflow, template, image pins, single-instance setting, mount,
and command. Test nonzero command propagation before trusting the release gate.

## References and historical evidence

- [Northflank migrations](https://northflank.com/docs/v1/application/release/run-migrations)
- [Northflank workflows](https://northflank.com/docs/v1/application/release/configure-workflows)
- [CI/CD override](https://northflank.com/docs/v1/application/release/manage-ci-cd)
- [Volume access](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)
- [Home-server execution record](https://github.com/SimHoZebs/home-server/blob/main/net-worth-estimator/MIGRATIONS.md)

The ordinary-guest cutover predates this shared contract. Its script remains
in infrastructure commit `592e6b8`. Northflank was initialized with the current
user-scoped model. Never replay that host-specific script against Northflank's
independent issuer or Postgres database.
