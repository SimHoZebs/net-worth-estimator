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
date-to-instant conversion, settled-bank repair, explicit purchase-row
conversion, the SimpleFIN v2 key rewrite, and removal of the completed
`posting_id_migrations` audit table may differ. The audit remains in the
verified backup. Purchase conversion preserves all other rows, identities,
and Analysis evidence. Unsafe purchase inputs leave the original unchanged. A
complete target without that audit table repeats read-only checks only and never reactivates
a post-upgrade owner disable.

The SimpleFIN v2 key conversion is one additional offline step in the same
candidate. `simplefin-v2-keys` rewrites `account_links`,
`posting_sync_keys`, and `suppressed_sync_keys` from bare account IDs to
connection-scoped keys, verifies row counts, and records
`simplefin-v2-keys`. It is a no-op when no SimpleFIN rows exist. When rows
exist, the deployment supplies `SIMPLEFIN_V2_MAPPING` as a private runtime
setting: a mode-0600 JSON map produced by `simplefin-v2-keys
--write-mapping` before the window. The map tool performs the only provider
read. A missing, ambiguous, or colliding mapping fails before publication.
A marked database repeats read-only verification and refuses bare keys.

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

`api-boot.sh` provisions or validates current schema on hosts configured
for that command. It does not provision users. Guest and signed-in workspaces
use the shared authorized-access path. This is fresh/current schema setup,
not the deployment migration hook. Keep the two separate.

## Supported execution paths

| Target | Adapter | Storage access and gate |
| --- | --- | --- |
| Home-server Komodo | Infrastructure `net-worth-estimator/migrate.sh` | Build target images, stop frontend/API, run `/app/migrate.sh` with `net-worth-data`; continue Compose only on exit 0. |
| Northflank | `northflank/release.json` and `northflank/api-command.json` | Build pinned images, back up identity, replace API with a maintenance process on its existing volume, run `/app/migrate.sh`, restore API command only on success. |
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
to built commits, not `latest`. For a manual **Northflank UI/API** run, override
`RELEASE_SHA` with a full reviewed commit. GitHub's manual dispatch instead
requests the current `main` commit. Builds stay sequential: one at a time.

`.github/workflows/northflank-release.yml` requests the workflow with the pushed
commit SHA only after the `Tests` workflow for that exact `main` push completes
successfully. A manual dispatch requests the current `main` commit and requires
a successful `main` push run for it. The release job has read-only repository
access and no Northflank API credential. Its `NORTHFLANK_RELEASE_WEBHOOK`
repository secret can only request workflow runs. The GitHub job confirms
dispatch, not production completion. Check the Northflank run separately. This
adapter does not depend on Northflank's native Git webhook registration, which
currently cannot access this repository through its Git link.

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
Only success restores `/app/api-boot.sh` and waits for service health.

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

## Unified projection schema

The unified projection adds tables and columns with no data conversion:
`provider_connections`, `projection_states` (plus `det_evaluations_json` and
`stoch_evaluations_json`), `projection_slices`, `projection_rows`,
`monte_carlo_statistics` (plus `p25`, `p50`, `p75`), one typed output table
per evaluation (`net_worth_threshold_outputs`, `account_balance_outputs`,
`posting_fulfillment_outputs`, `cycle_fulfillment_outputs`,
`planned_purchases_outputs`, `financial_independence_outputs`,
`whatif_outputs`),
`checkpoints.provider`, and on `postings`
`projection_slice_id`, `event_json`, `applied_amount`, plus `outcome`.

The offline body treats this group as absent, complete, or invalid. Absent
creates every table and adds every column on the verified backup candidate.
Complete repeats read-only. A partial group fails before mutation. `setupdb`
then validates the complete schema on the candidate. Existing
`projection_artifacts` tables are preserved when present but are no longer
required. Previously stored `simplefin` row sources are normalized to `banksync` by
the one-time bank-source script below. Provider identity remains in sync
keys. Fresh databases need no body work: `SetupDatabase` creates the
complete schema.

## Bank source normalization (one-time)

Run `backend/scripts/one-time/bank-source/run.sh` with every API writer
stopped and the real database path. The script backs up the database with
SQLite's backup API, rewrites `postings.source` and `checkpoints.source`
from `simplefin` to `banksync`, and fails if any legacy value remains.
Verify both counts are zero before starting the API. The strict settlement
matcher requires `banksync`.

Run this on every supported target before deploying the strict matcher.
Retire the script only after every target records the migration and the
strict matcher is live.
