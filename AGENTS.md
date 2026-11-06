# AGENTS.md - Net Worth Estimator

## Communication style

- Do not state file name or line number unless it's absolutely necessary to communicate the idea.
- Use established terminologies in the project instead of inventing a synonym.
- Prefer to use full sentences with minimal punctuations that breaks it.

## Subagent model

- ONLY if you are an OpenAI model, set `model: "opencode-go/muse-spark-1.3-contributor"` explicitly on every subagent call. Otherwise, leave it empty.

## Latest state only

- This is pre-production software. Keep only the current model, schema, API, configuration, and browser-storage formats.
- Delete application legacy aliases, migration fallbacks, retired modes, and tests dedicated to legacy acceptance, rejection, or migration.
- Database upgrades belong in separate one-time operator scripts. Never put conversion logic in runtime, setup, or normal import paths.
- Keep current-state validation and tests. Test one-time scripts for conversion correctness and data safety.
- Retire one-time scripts through `deploy/MIGRATIONS.md` only after every supported target verifies the upgrade.

## Parallel work

- Before you begin new work, ensure you are working on the latest commit of origin/main. This does not apply if your work is explicitly regarding existing work in your tree.
- Run parallel dev work in an isolated slot (`scripts/dev setup --slot NAME`, `scripts/dev ps-all`). Never stop the canonical stack or steal its ports to free your own.
- Several agents may share one worktree and one branch under a single orchestrator that owns the branch.
- The host's tailnet Serve routes and the canonical identity issuer are shared. Never change them.
- Cut a feature branch for your work. Any agent whose branch has a green `Tests` run may ship it without waiting for the user: fetch, squash with semantic text, push fast-forward. If the push loses a race, refetch and retry. Never rebase pushed commits, never force-push, never amend commits you do not own.
- Land to main by rebasing your private commits onto the tip and fast-forwarding main (rebase-merge, linear history, no merge bubbles); delete the landed branch after. If main moved, refetch and rebase again. This never force-pushes: the rebase touches only your own commits and main moves fast-forward.
- Do not merge `origin/main` into feature branches mid-task. Use `git fetch origin` for status; rebase private commits only while unpushed.
- Do not merge feature into feature. Push race orders landings only for independent changes that each have a green `Tests` run against `origin/main` alone, or the same failure that reproduces on `origin/main`.
- Keep atomic changes atomic: one branch, one worktree for that branch. If DB plus auth plus frontend plus migration must land together to stay green, do not split them across parallel branches. Work in that one worktree, parallel only under a single orchestrator as above. A branch that breaks build or tests must not land, even with a dependency note. Dependent work waits for the base to land, then rebases private commits while unpushed.
- Ship is claim-by-push, not assignment: resolve mechanical conflicts yourself, re-verify, restore foreign files byte-identical. Escalate to the user only for product decisions.
- Prune only your own worktree and branch after ship lands. Never touch another session's scope.
- Before any merge, confirm no worktree is mid-rebase or mid-merge.
- Run the narrowest local checks before you commit, and commit only your own scope. Split semantic commits.

## Start and verify

- Dev stack: `dev/README.md`. Verification gate: `TESTING.md`.
- GitHub Actions is the default full gate. Run the narrowest local check for what you touched, push the branch, and fix from the hosted run. Do not run every suite locally before each push.
- Every branch push triggers the `Tests` workflow. Watch the run for your exact commit before landing:

```bash
branch="$(git branch --show-current)"
git push -u origin "$branch"
sha="$(git rev-parse HEAD)"
run=""
for attempt in 1 2 3 4 5 6; do
  run="$(gh run list --branch "$branch" --workflow tests.yml --event push --limit 20 \
    --json databaseId,headSha --jq ".[] | select(.headSha == \"$sha\") | .databaseId" | head -1)"
  [ -n "$run" ] && break
  sleep 10
done
[ -n "$run" ] || { echo "no Tests run for $sha" >&2; exit 1; }
gh run watch "$run" --exit-status
```

- Resolve the run ID once, then let `gh run watch` be the single waiter. Do not run extra `gh run list` or `gh run view` polls alongside it. Repeated list and view calls trigger a secondary GitHub Actions limit with `403`. On `403` or `429`, stop polling for 120 seconds, then retry a single check. Never tight loop list calls.

- Read the failing job log first with `gh run view "$run" --log-failed`. Download the failure artifact when the log prints only a tail: `gh run download "$run" -n gate-artifacts` or `-n integration-artifacts`.
- Push fixes to the same branch. The workflow reruns for the new commit. Reuse the same feedback loop until it is green. A cancelled watch means a newer push replaced the run; resolve the new SHA instead of debugging the cancelled one.
- Land only when the branch run is green. The one exception is a failure that reproduces on the exact current `origin/main` SHA: link that failing run in the landing message and file the fix before or with the landing. A release still requires every gate to pass on the release commit.
- After the landing push, resolve the `main` run for the new SHA and watch it. Squash or rebase mints a different commit from the one you tested. If the landed run is red for a new reason, fix it immediately.
- `End-to-end tests` is not part of per-branch work. It runs nightly, on dispatch, and on pull requests carrying the `e2e` label. Dispatch it for changes to auth, images, migrations, or the proxy.
- When CI is unavailable, `scripts/test --gate` is the local equivalent of the `Tests` workflow.
- If your work impacts the frontend interactions or visuals in any way, take screenshots and/or gifs of the workflow you touched and share in chat.

## Landing visualization (viz/)

- `viz/` holds the backlog landing map (`nwe-landing-map.html`, Mermaid diagrams) and `viz/captures/` (Playwright screenshots/clips). Gitignored; never commit.
- Serve from `viz/`: `python3 -m http.server 8123 --bind 127.0.0.1` (LAN: `--bind 0.0.0.0`). Map at `/nwe-landing-map.html`, captures at `/captures/<area>/<file>`.
- Capture against TESTING.md browser harnesses on isolated ports; place media under `viz/captures/<area>/` with descriptive names and display it in chat through markdown formatting.
- Keep worktrees out of `/tmp`. Use the standard worktree dir; relocate with remove plus re-add at the same ref when a move must cross devices.

## Production deployment

- Frontend is Vercel project `simhozebs-projects/net-worth-estimator` (`https://net-worth-estimator.vercel.app`). The CLI evaluates root `vercel.mjs` with local shell env, so export `BACKEND_URL`, `NET_WORTH_ESTIMATOR_PUBLIC_URL`, and the proxy secret for CLI runs. `.vercelignore` patterns are root-anchored.
- API is Northflank service `nwe-api` in project `net-worth` (us-central, Sandbox) at `https://http--nwe-api--bc5m9smksgps.code.run`. Keep the `http--` prefix. Smallest compute plan, 6 GB volume at `/data`, boots with `/app/api-boot.sh`, health at `/readyz`, port 10000. The `Publish container images` workflow builds the backend, frontend, Casdoor, and upstream images after `Tests`; Northflank deploys the pinned backend and Casdoor tags.
- Identity is service `nwe-casdoor` at `https://http--nwe-casdoor--bc5m9smksgps.code.run` (port 8000, health `/api/health`). It builds from `auth/casdoor/Dockerfile`; config renders at boot from `auth/casdoor/render/` templates. State lives in Postgres addon `nwe-casdoor-db`, wired through secret group `casdoor-pg` with weekly dumps. Never install lsof in the image: Casdoor kills PID 1 based on its output. The Postgres seed is unbranded because Postgres enforces column widths.
- `provision.mjs` writes guest and owner subjects to `bootstrap.json`. The API reads the guest subject from `NET_WORTH_ESTIMATOR_GUEST_SUBJECT`. SimpleFIN credentials stay in each user's rows and every configured user can sync them. The boot wrapper runs schema setup only. Use explicit `setupdb --issuer ... --subject ...` before guest-data publication.
- Northflank notes: env PATCH replaces all variables; boot command nests under `deployment.docker`; use exact `Dockerfile` names; one build at a time; one free volume; no volume snapshots, so the API database has no automated backup.
- The API token is the Komodo variable `NORTHFLANK_API_TOKEN`. Spend runs near $15 of the $20 allowance; check dashboard billing before growing.
