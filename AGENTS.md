# AGENTS.md - Net Worth Estimator

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
