# AGENTS.md - Net Worth Estimator

## Subagent model

- Set `model: "opencode-go/muse-spark-1.3-contributor"` explicitly on every subagent call, including exploration, implementation, and review.
- Never rely on model inheritance or the default model.
- Verify each child with `opencode api get /api/session/SESSION_ID` before using its work. Check `data.model.providerID` and `data.model.id`.
- If Muse Spark 1.3 Contributor is unavailable, stop delegation and report the blocker. Never silently substitute GPT or another model.

## Latest state only

- This is pre-production software. Keep only the current model, schema, API, configuration, and browser-storage formats.
- Delete application legacy aliases, migration fallbacks, retired modes, and tests dedicated to legacy acceptance, rejection, or migration.
- Database upgrades belong in separate one-time operator scripts. Never put conversion logic in runtime, setup, or normal import paths.
- Keep current-state validation and tests. Test one-time scripts for conversion correctness and data safety.
- Retire one-time scripts through `deploy/MIGRATIONS.md` only after every supported target verifies the upgrade.

## Parallel work

- Default is one agent per worktree plus one private branch. Git blocks two worktrees on one branch, and detached HEAD loses commits. Several agents may share one worktree and one branch only under a single orchestrator that owns the branch, assigns non-overlapping scopes, and serializes edits, commits, and verification.
- Never commit, merge, push, clean up, or otherwise touch another session's branches, worktrees, or dirty files.
- Run parallel dev work in an isolated slot (`scripts/dev setup --slot NAME`, `scripts/dev ps-all`). Never stop the canonical stack or steal its ports to free your own.
- The host's tailnet Serve routes and the canonical identity issuer are shared. Never change them.
- Cut a feature branch for your work. Any agent whose branch passes `TESTING.md` may ship it without waiting for the user: fetch, squash with semantic text, push fast-forward. If the push loses a race, refetch and retry. Never rebase pushed commits, never force-push, never amend commits you do not own.
- Do not merge `origin/main` into feature branches mid-task. Use `git fetch origin` for status; rebase private commits only while unpushed.
- Do not merge feature into feature. Push race orders landings only for independent changes that each pass `TESTING.md` against `origin/main` alone.
- Keep atomic changes atomic: one branch, one worktree for that branch. If DB plus auth plus frontend plus migration must land together to stay green, do not split them across parallel branches. Work in that one worktree, parallel only under a single orchestrator as above. A branch that breaks build or tests on `origin/main` must not push, even with a dependency note. Dependent work waits for the base to land, then rebases private commits while unpushed.
- Ship is claim-by-push, not assignment: resolve mechanical conflicts yourself, re-verify, restore foreign files byte-identical. Escalate to the user only for product decisions.
- Prune only your own worktree and branch after ship lands. Never touch another session's scope.
- Before any merge, confirm no worktree is mid-rebase or mid-merge.
- Verify before you commit, and commit only your own scope. Split semantic commits.

## Start and verify

- Dev stack: `dev/README.md`. Verification gate: `TESTING.md`.

## Production deployment

- Frontend is Vercel project `simhozebs-projects/net-worth-estimator` (`https://net-worth-estimator.vercel.app`). The CLI evaluates root `vercel.mjs` with local shell env, so export `BACKEND_URL`, `NET_WORTH_ESTIMATOR_PUBLIC_URL`, and the proxy secret for CLI runs. `.vercelignore` patterns are root-anchored.
- API is Northflank service `nwe-api` in project `net-worth` (us-central, Sandbox) at `https://http--nwe-api--bc5m9smksgps.code.run`. Keep the `http--` prefix. Smallest compute plan, 6 GB volume at `/data`, boots with `/app/render-free-boot.sh`, health at `/readyz`, port 10000.
- Identity is service `nwe-casdoor` at `https://http--nwe-casdoor--bc5m9smksgps.code.run` (port 8000, health `/api/health`). It builds from `auth/casdoor/Dockerfile`; config renders at boot from `auth/casdoor/render/` templates. State lives in Postgres addon `nwe-casdoor-db`, wired through secret group `casdoor-pg` with weekly dumps. Never install lsof in the image: Casdoor kills PID 1 based on its output. The Postgres seed is unbranded because Postgres enforces column widths.
- `provision.mjs` writes guest and owner subjects to `bootstrap.json`. The API reads them from `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` (and `OWNER_SUBJECT`). The boot wrapper runs schema setup only. Use explicit `setupdb --issuer ... --subject ...` before guest-data publication.
- Northflank notes: env PATCH replaces all variables; boot command nests under `deployment.docker`; use exact `Dockerfile` names; one build at a time; one free volume; no volume snapshots, so the API database has no automated backup.
- The API token is the Komodo variable `NORTHFLANK_API_TOKEN`. Spend runs near $15 of the $20 allowance; check dashboard billing before growing.
