# Deployment watchdog

The watchdog owns deployment failures. It detects them, fixes them, re-runs the
release, and verifies production. It never waits for a human to notice.

`node deploy/watchdog/incident.mjs` is the detection signal. It exits 0 when
there is an incident and 1 when the pipeline is healthy. It checks the Northflank
release for the current `main` tip, the frontend deploy for that tip, and
readiness. A check that cannot run is reported as a blind spot rather than
swallowed, and a watchdog with no working checks wakes an agent instead of
staying quiet.

Readiness is not evidence while a release window is open, because the workflow
puts the API into maintenance on purpose. A release that stays open past thirty
minutes is itself the incident, and the report carries the readiness state so a
stranded window is never hidden behind a release that will not finish.

## One owner

The watchdog is the only writer of live deployment state: the Northflank
workflow definition, the API service command, and release requests. Feature
agents keep ownership of code fixes for their own changes, but they hand
deployment writes to the watchdog.

The agent that landed a commit still verifies its release. The watchdog acts
when the incident stalls, meaning the release is red, no new release run has
started, and `main` has not advanced. An active fix always shows up as a new
commit or a new release run, so the stall signal is observable without a claim
or lock protocol.

## The loop

1. Read the incident report and confirm the failure from the run itself, not
   from the summary.
2. Classify the failure:
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
restore a backup to recover a failed release. That policy is deferred, not
rejected, and returns only when a deliberate data-loss decision exists.

## When changes arrive mid-fix

The incident is tracked against the SHA that failed, and every pass re-reads the
`main` tip.

- The new tip's release succeeded: the newer commit resolved it. Close the
  incident and record which commit closed it.
- The new tip's release failed the same way: the fix is still needed. Rebase the
  fix branch onto the new tip, or drop it when the new commit already contains
  the fix.
- The new tip's release has not started: wait. It supersedes the failed target.

Never release a `main` commit older than the one that already published a
migration. After a migration publishes, release that same reviewed target or a
newer commit that contains it, and never older code.

## Boundaries

- Never release a commit older than the migration that already published, and
  never re-request a release already superseded.
- Never restore a database backup.
- Never touch another session's worktree, branch, or uncommitted files. Restore
  foreign state byte-identical if a pass disturbs it.
- Preserve the release webhook token, arguments, and argument overrides when
  updating the workflow definition, and read the applied definition back.
- Record the run ID, the failed step, the fix, and the verification in the
  session, so the next pass reasons from evidence rather than from a summary.
