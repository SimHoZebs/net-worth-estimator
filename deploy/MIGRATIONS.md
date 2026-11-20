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
| Transaction simulation split | Tool at `backend/scripts/one-time/transaction-sim-split` | Retain until every supported target records the split. Never run the planned-purchase conversion against a pre-split target on its own; the body orders the split first. |
| Planned purchases | [planned-purchases README](../backend/scripts/one-time/planned-purchases/README.md) | Runs inside the body after the split and converts retired purchase policies. Unsafe inputs leave the original unchanged. |
| Bank source normalization | [bank-source README](../backend/scripts/one-time/bank-source/README.md) | Run on every supported target before deploying the strict settlement matcher. Both legacy counts must read zero before the API starts. |
| No-op checkpoint prune | [noop-checkpoints README](../backend/scripts/one-time/noop-checkpoints/README.md) | Unverified on Compose, dev, and Northflank. Runs inside the body after provisioning; deletes only forward sync-owned zero-delta checkpoints. |
| SimpleFIN v2 keys | Tool usage: `simplefin-v2-keys --db PATH (--mapping PATH \| --write-mapping PATH)` | Runs inside the body. When bare keys exist, supply `SIMPLEFIN_V2_MAPPING` as a mode-0600 JSON map produced by `--write-mapping` before the window; the map tool performs the only provider read. A missing, ambiguous, or colliding mapping fails before publication. No-op when no SimpleFIN rows exist. |
| Promotion merchant key | Body in `deploy/migrate.sh` (additive `analysis_promotions.merchant_key`) | The Northflank database carries the column with no NULL keys across its promotions, so the add path ran there; the release that applied it is not recorded. Unverified on Compose and dev. Adds `merchant_key TEXT NOT NULL DEFAULT ''` to existing promotions with no row rewrites; the frozen offline DDL carries it for fresh sources. |
| Schedule recurrences | Body in `deploy/migrate.sh` (recurrence columns plus frequency backfill) | Verified on Northflank: the first attempt of release `main-ece20d55ae00` (run `a2f1eb8b-1c08-4448-835c-c68c31a8e811`) converted all nine monthly rules to unit `month` with interval 1 and `byDate`, passed the candidate postconditions, and published them; the green retry `691f6dab-9cc0-4822-8e46-0cf484e0b483` then took the no-op path. Unverified on Compose and dev. Rebuilds `recurrence_rules` from the retired `frequency` column (daily to every day, weekly to the start weekday, monthly to the clamped start day, quarterly to every third month, annual to the yearly date) with row-count and mapping postconditions; unknown frequencies and undated weekly rows fail the source preflight. Fresh databases carry the recurrence columns from `setupdb` with no legacy path. |
| Statement closing day | [statement-closing-day tool](../backend/scripts/one-time/statement-closing-day/main.go) | Runs inside the body. Reconciles the retired household cycle start in `safe_spending_settings.settings_json` and the optional per-card `payment_terms.statement_day` into one authoritative `accounts.statement_closing_day` (1..31, default 19) on every account, including cards with no payment terms. An authored card value is preserved unchanged; the household cycle start moves back one day (1 wraps to 31, so the default start 20 yields 19) only where no card value was authored. The tool strips the retired JSON keys, drops the retired terms column, and marks the source. The source and target shapes are mutually exclusive and fail closed otherwise. Unverified on Compose, dev, and Northflank. |
| Safe Spending settings and savings goal | Body in `deploy/migrate.sh` | Unverified on Compose, dev, and Northflank. After the closing-day reconciliation, adds missing `cycleStartDay` (20), `paydayDay` (30), and `savingsTarget` (0) to each saved settings document, then carries the retired `reserve` into `savingsTarget` where the goal is missing or zero, preserves a nonzero goal, and removes `reserve`. Only saved documents are edited; no row is created for an unsaved user. |
| Derived card statements | Body in `deploy/migrate.sh` (rekey `statement_allocations`, drop `card_statements`, `derived-card-statements-v1` marker) | Unverified on Compose, dev, and Northflank. Statements are now derived from the card's closing-day cadence plus bank evidence, so `card_statements` is removed. On a legacy target every allocation is mapped through the row it references to `closingDate~accountId` before that table is dropped; unmappable allocations fail closed. The allocations table is rebuilt without the retired statement FK and events are preserved. Fresh targets provision only `statement_allocations`, `statement_allocation_events`, and the new marker, all empty. Fails closed on any partial table, marker, or key shape. |
| Declared credit-card kind | Body in `deploy/migrate.sh` | Unverified on Compose, dev, and Northflank. Idempotent data promotion: an account still labelled `debt` that is explicitly named in a saved `accountIds` selection becomes `credit_card`, so an owner's tracked cards survive the switch to declared-card-only Safe Spending. Names and the generic debt fallback are never used to classify; an unselected debt account that only looks like a card by name is flagged in the migration output for operator review, not changed. Fails closed when an explicitly selected debt account survives the promotion. |

## Supported execution paths

| Target | Adapter | Storage access and gate |
| --- | --- | --- |
| Home-server Komodo | Infrastructure `net-worth-estimator/migrate.sh` | Build target images, stop frontend/API, run `/app/migrate.sh` with `net-worth-data`; continue Compose only on exit 0. |
| Northflank | `northflank/release.json` | Deploy pinned GHCR images, back up identity, set the durable maintenance marker on the existing volume, verify `/readyz` answers `maintenance`, run `/app/migrate.sh`, clear the marker and restart only on success. |
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
7. Rehearse with disposable state, including failure, retry, and repeat success,
   and record the full-conversion wall time against the target's execute-action
   budget.
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

On failure, the adapter leaves a marker-aware API stopped or in maintenance; a
target that is not in maintenance can keep running, so stop it
before any manual migration. Inspect the
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

The files in `northflank/` define only the `waypoint-release` project workflow.
Project workflows cannot invoke team templates, so the definition is
self-contained and references no team template.

The release waits for the running API container, creates the durable marker
`/data/waypoint-maintenance` with an execute action, and deploys the target
image. On boot, `/app/northflank-runtime.py` sees the marker and answers
`/readyz` as `maintenance` from `/tmp/waypoint-maintenance`. It starts neither
the ML sidecar nor `/app/server`, and its docroot never includes `/data`.
Before it runs the migration, the workflow reads the container's local
`/readyz` and requires the body to be exactly `maintenance`. A target that is
not in maintenance answers `ok` and fails that step, so the release never
migrates under live writers. Clearing the marker and restarting the service is
the only switch back to the API.

Use workflow concurrency `queue` so releases never overlap or drop newer commits.
Disable per-service CI/CD bypasses: disable direct Git CI and pin both services
to published image tags, not `latest`. For a manual **Northflank UI/API** run,
override `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` with reviewed values.
GitHub's manual dispatch instead requests the current `main` commit and its
published images. Releases stay sequential: one at a time.

`.github/workflows/northflank-release.yml` triggers on the `Tests` workflow for
the exact `main` push. A documentation-only push leaves the code gates skipped,
so no release is requested for that commit. The workflow waits for the pinned
backend-northflank and Better Auth image manifests, then requests the workflow
with those image references. The release job has
read-only repository access and no Northflank API credential. Its webhook secret
can only request workflow runs. The GitHub job confirms dispatch, not production
completion. Check the Northflank run separately.

The ReadWriteOnce volume stays attached to its one API service. Northflank
terminates the old pod before starting another pod with that volume. The
maintenance process serves only `/tmp/waypoint-maintenance`, never `/data`.
The API and scheduler are absent. Its `/readyz` body says `maintenance`, not
`ok`. The workflow deploys the target image, requires that same `maintenance`
body from inside the container, and runs `/app/migrate.sh` as
UID/GID `10001`, with `dispatchOnly: false` so the node awaits that command.
Northflank caps an execute action at 15 seconds and has no timeout field for
it, so the await ends at that wall, and a wall failure is a step failure, not a
migration verdict. Budget a new conversion against it on the target compute
plan. The no-op verify path on the live database takes 2 seconds, while the
first schedule-recurrence conversion took 13 seconds at `nf-compute-10`; with
the exec attach that step hit the wall. The body publishes only at its end and
keeps its verified backup. Recover an overrun by running the same body through
`northflank exec service`, which has no wall, requiring exit 0, and then
requesting the release again; read its failure line before acting on the
retained backup.
Only a zero exit removes `/data/waypoint-maintenance` and restarts the service;
the supervisor then runs `/app/api-boot.sh` to validate the migrated schema
before the server starts. The workflow waits for the API container to be
running; confirm `/readyz` answers `ok` separately before treating the release
as complete. If the service is not running before a release, restart it first
so the marker action has a container to reach. If the API image cannot boot at
all, the manual service-command patch remains the last-resort path: patch the
command to clear the marker, then restore `python /app/northflank-runtime.py`.
If the verification step failed because the container answered `ok`, that
target is not in maintenance and may still serve writers. Stop it and ensure a
marker-aware image boots with the marker before running any migration by hand.

Postgres dumps precede identity-image replacement. They do not back up SQLite.
A pending migration must take and verify the financial backup in its shared
body before data edits. Volume snapshots are a separate account capability,
not a prerequisite for SQLite's backup operation.

Reapply reviewed JSON through the Northflank API when definitions change.
Read back the workflow, image pins, single-instance setting, mount, and service
command. Pause the release trigger during a migration window.

## References

- [Northflank migrations](https://northflank.com/docs/v1/application/release/run-migrations)
- [Northflank workflows](https://northflank.com/docs/v1/application/release/configure-workflows)
- [CI/CD override](https://northflank.com/docs/v1/application/release/manage-ci-cd)
- [Volume access](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)
