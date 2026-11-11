---
name: deployment-watchdog
description: Fix a failed net-worth-estimator deployment. Use when a release failed, a maintenance window is stranded, readiness is not ok, or a frontend deploy failed. Covers classification, fixing forward, re-running the release, and verifying production.
---

# Deployment watchdog

Own the failure until production is healthy. Never wait for a human to notice.

Detection is `node deploy/watchdog/incident.mjs`. It exits 0 when there is an
incident and 1 when healthy, and prints the evidence. A cron entry runs it every
five minutes and spawns a headless run with that report when it exits 0.

## One owner

You are the only writer of live deployment state: the Northflank workflow
definition, the API service command, and release requests. Feature agents own
their own code fixes and hand deployment writes to you.

The agent that landed a commit verifies its release. Take over when the incident
stalls: the release is red, no new release run has started, and `main` has not
advanced.

## The loop

1. Read the report and confirm the failure from the run itself, not the summary.
2. Classify:
   - **Transient.** A refused command, a `503`, a timeout. Re-request the
     release and verify. Do not change code for a transient.
   - **Live infrastructure.** The workflow definition, the service command, or
     the trigger. Patch live state, then re-request.
   - **Code.** A migration, a schema, an image, or CI. Branch, fix, test, land,
     and let the release run.
3. Fix forward. Reproduce the failing step before and after the change.
4. Re-run the release for the current `main` tip.
5. Verify: the `migrate` step exits zero, readiness answers `ok`, and the
   frontend serves the landed commit. Record the run ID and the evidence.

## No rollback

A failed migration leaves the database unchanged because the migration body
fails closed and keeps a verified backup. Repair the cause and re-run. Never
restore a backup to recover a failed release.

## When changes arrive mid-fix

Track the incident against the SHA that failed, and re-read the `main` tip on
every pass.

- The new tip's release succeeded: the newer commit resolved it. Close the
  incident and record which commit closed it.
- The new tip's release failed the same way: the fix is still needed. Rebase the
  fix onto the new tip, or drop it when the new commit already contains the fix.
- The new tip's release has not started: wait. It supersedes the failed target.

Never release a `main` commit older than the one that already published a
migration. After a migration publishes, release that same reviewed target or a
newer commit that contains it, never older code.

## Boundaries

- Never restore a database backup.
- Never touch another session's worktree, branch, or uncommitted files. Restore
  foreign state byte-identical if a pass disturbs it.
- Preserve the release webhook token, arguments, and argument overrides when
  updating the workflow definition, and read the applied definition back.
- Record the run ID, the failed step, the fix, and the verification.

## Commands

- Detect: `node deploy/watchdog/incident.mjs`
- Inspect a run: `northflank get workflow-run --project net-worth --workflow waypoint-release --run <id> --output json`
- Inspect logs: `northflank get service logs --project net-worth --service nwe-api`
- Re-request the release: `gh workflow run northflank-release.yml --ref main`
