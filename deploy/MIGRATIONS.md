# Migration SOP for every deployment

## One contract

`deploy/migrate.sh` is the single replaceable migration body. The API image
contains it at `/app/migrate.sh`. Deployment adapters run it from the **target
image**, with its normal environment, non-root user, and actual data mount.
A nonzero exit prevents API startup. The server never invokes this script.

Keep one-time SQL and provider edits in this file. Do not add a migration
registry, numbered chain, or historical-model converter to the backend.
Use existing `setupdb` and `refreshmodel` tools where appropriate.
The image also provides `sqlite3` for offline SQL and SQLite-safe backups.

The authoritative step list is the body itself; this SOP states the contract
around it, not the step list. In short: every conversion runs inside a candidate copy of a verified backup,
`setupdb` validates the complete current schema on that candidate, and only
the verified candidate is published over the original database. Failed
conversion, setup, or postconditions leave the original database
byte-identical with the verified backup retained. No automatic rollback
resumes the API and the body never restores over the data file. The private
`<database>.analysis-migration-pending` file from an actual previous attempt
is recognized fail-closed. Retain this body until every supported target
verifies it.

Databases that still carry pre-rename tables must first run the one-time
`/app/upgrade-transaction-rename` tool (with the API stopped), then run this
body. See [its README](../backend/scripts/one-time/transaction-rename/README.md)
for the exact command.

`api-boot.sh` provisions or validates current schema on hosts configured
for that command. It does not provision users. This is fresh/current schema
setup, not the deployment migration hook. Keep the two separate.

## Pending one-time migrations

Retire each script through this ledger only after every supported target
verifies the upgrade. Do not auto-release a pending migration to an existing
target before its operator window is complete.

| Migration | Operator doc | Status and notes |
| --- | --- | --- |
| Payment patterns | [payment-patterns README](../backend/scripts/one-time/payment-patterns/README.md) | Unverified on Compose, dev, and Northflank. Existing income targets need the offline upgrade and a fresh learner database. |
| Account displays | [Existing databases](../docs/account-displays.md#existing-databases) | Unverified on Compose, dev, and Northflank. Adds `account_displays` without changing financial rows; loan pairs link explicitly with reviewed IDs. |
| Identity and policy cutover | [one-time cutover](../auth/better-auth/one-time/README.md) | Runs outside API startup, setup, and `migrate.sh`. Preserve the exact issuer and subjects. Northflank release stays gated on `AUTH_CUTOVER_READY=true` with prepared service and addon IDs. No source push performs a live identity conversion. |
| Transaction simulation split | Tool at `backend/scripts/one-time/transaction-sim-split` | Retain until every supported target records the split. Never run the planned-purchase conversion against a pre-split target on its own; the body orders the split first. |
| Planned purchases | [planned-purchases README](../backend/scripts/one-time/planned-purchases/README.md) | Runs inside the body after the split and converts retired purchase policies. Unsafe inputs leave the original unchanged. |
| Bank source normalization | [bank-source README](../backend/scripts/one-time/bank-source/README.md) | Run on every supported target before deploying the strict settlement matcher. Both legacy counts must read zero before the API starts. |
| No-op checkpoint prune | [noop-checkpoints README](../backend/scripts/one-time/noop-checkpoints/README.md) | Unverified on Compose, dev, and Northflank. Runs inside the body after provisioning; deletes only forward sync-owned zero-delta checkpoints. |
| SimpleFIN v2 keys | Tool usage: `simplefin-v2-keys --db PATH (--mapping PATH \| --write-mapping PATH)` | Runs inside the body. When bare keys exist, supply `SIMPLEFIN_V2_MAPPING` as a mode-0600 JSON map produced by `--write-mapping` before the window; the map tool performs the only provider read. A missing, ambiguous, or colliding mapping fails before publication. No-op when no SimpleFIN rows exist. |

## Supported execution paths

| Target | Adapter | Storage access and gate |
| --- | --- | --- |
| Home-server Komodo | Infrastructure `net-worth-estimator/migrate.sh` | Build target images, stop frontend/API, run `/app/migrate.sh` with `net-worth-data`; continue Compose only on exit 0. |
| Northflank | `northflank/release.json` and `northflank/api-command.json` | Deploy pinned GHCR images, back up identity, replace API with a maintenance process on its existing volume, run `/app/migrate.sh`, restore API command only on success. |
| Other container hosts | Explicit stopped-API maintenance operation | Run the same image command with the real disk attached. A job without that disk does not migrate production. |

Vercel contains no financial database and needs no database migration hook.
Render disks are unavailable to pre-deploy jobs. Use [explicit disk maintenance](render.md#explicit-disk-maintenance-on-render).
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

For an API contract change, hold Vercel production deploys until Northflank
passes the migration and API checks. Disable the `Deploy frontend to Vercel`
workflow for the window; preview builds can continue. Re-enable it only after
the new API contract is live. The workflow then deploys the matching tested
frontend commit; Git production deployments stay disabled.

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
to published image tags, not `latest`. For a manual **Northflank UI/API** run,
override `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` with reviewed values.
GitHub's manual dispatch instead requests the current `main` commit and its
published images. Releases stay sequential: one at a time.

`.github/workflows/northflank-release.yml` triggers on the `Tests` workflow for
the exact `main` push, waits for the pinned backend and Better Auth image manifests,
then requests the workflow with those image references. The release job has
read-only repository access and no Northflank API credential. Its webhook secret
can only request workflow runs. The GitHub job confirms dispatch, not production
completion. Check the Northflank run separately.

The ReadWriteOnce volume stays attached to its one API service. Northflank
terminates the old pod before starting another pod with that volume. The
maintenance process serves only `/tmp/waypoint-maintenance`, never `/data`.
The API and scheduler are absent. Its `/readyz` body says `maintenance`, not
`ok`. The workflow deploys the target image and runs `/app/migrate.sh` as
UID/GID `10001`, with `dispatchOnly: false` to wait for its exit status.
Only success restores `/app/api-boot.sh` and waits for service health.

Postgres dumps precede identity-image replacement. They do not back up SQLite.
A pending migration must take and verify the financial backup in its shared
body before data edits. Volume snapshots are a separate account capability,
not a prerequisite for SQLite's backup operation.

Reapply reviewed JSON through the Northflank API when definitions change.
Read back the workflow, template, image pins, single-instance setting, mount,
and command. Pause the release trigger during a migration window.

## References

- [Northflank migrations](https://northflank.com/docs/v1/application/release/run-migrations)
- [Northflank workflows](https://northflank.com/docs/v1/application/release/configure-workflows)
- [CI/CD override](https://northflank.com/docs/v1/application/release/manage-ci-cd)
- [Volume access](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)

The ordinary-guest cutover predates this shared contract. Never replay that
host-specific script against Northflank's independent issuer or database.
