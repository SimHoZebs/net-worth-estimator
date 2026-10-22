# Plan saves: describe the actual conflict and partial-save behavior

The frontend guide promises stronger concurrent-save protection than the API supplies. A server change can occur after the browser loads its plan. Later saves can overwrite it, and a multi-entry save can commit early entries before a later failure.

Describe load-time stale-change detection, last-write-wins entry saves, and possible partial completion in `frontend/RUNNING.md`. The saved-plan identity is a comparison value, not a write precondition. Conditional writes and atomic multi-entry saves are separate designs.

- Claim: `frontend/RUNNING.md:58-60`.
- Load/save paths: `frontend/src/state/workspaceStore.ts:611-632,830-839`, `frontend/src/api/rowSync.ts:355-570`.
- Existing contract/test: `TECHNICAL_OVERVIEW.md:48`, `frontend/src/state/remoteHooks.test.ts:592-659`.

Trace request headers and the complete save path. Distinguish existing stale-load coverage from new concurrent-writer and partial-save tests. Saved-snapshot reuse does not add these protections.
