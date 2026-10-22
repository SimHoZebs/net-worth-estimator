# Monthly investing: use one saved-plan identity

Changing `Monthly investing` from `600` to `900` creates unsaved changes that survive reloads. Recovery compares the saved plan with the plan those changes started from. The server already supplies a complete content identity, but the browser also calculates and stores a second identity from its own field list.

Remove the browser calculation and its tracking. Use only `baseRevision`, the existing field for the server-provided identity. Accept older records with a usable server identity and ignore their extra identity fields.

Missing or changed identity after reload must leave the changes exportable and block saving. Apply the same check if a server save succeeds but browser cleanup fails. Live editing without an identity remains supported. Correct mocks that change content without changing `"sha256-test"`.

- Duplicate calculation: `frontend/src/state/remoteStorage.ts:34-181`.
- Recovery and failed cleanup: `frontend/src/state/workspaceStore.ts:613-669,911-962`.
- Server identity: `backend/internal/store/model.go:19-29`, `backend/internal/api/model_handlers.go:34-43`.
- Tests and mocks: `frontend/src/state/remoteHooks.test.ts:339-446,592-709,806-859,1135-1203,1497-1537`.
- Browser workflow: `frontend/tests/workspace.spec.ts:61-89`.

Verify matching, changed, and missing identities, older records, failed cleanup after save, and the real-backend `600 → 900` workflow. The main risk is loss of recoverable changes. The audit identified 183 candidate deletion lines, not measured net savings. This change does not add concurrent-save protection.
