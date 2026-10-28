# AGENTS.md - Net Worth Estimator

## Parallel work

- One agent per worktree. Never commit, merge, push, clean up, or otherwise touch another session's branches, worktrees, or dirty files.
- Work with other agents instead of routing around them through the user. Resolve mechanical conflicts yourself — merge, re-verify, restore foreign state byte-identical — and escalate only genuine product decisions.
- Run parallel dev work in an isolated slot (`scripts/dev setup --slot NAME`, `scripts/dev ps-all`). Never stop the canonical stack or steal its ports to free your own.
- The host's tailnet Serve routes and the canonical identity issuer are shared. Never change them.
- Cut a feature branch for your work. Trunk merges belong to the parent or user unless the task explicitly orders otherwise. Never rebase pushed commits, never force-push, never amend commits you do not own.
- Before any merge, confirm no worktree is mid-rebase or mid-merge.
- Verify before you commit, and commit only your own scope. Split semantic commits.

## Start and verify

- Dev stack: `dev/README.md`. Verification gate: `TESTING.md`.
