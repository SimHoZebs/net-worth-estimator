---
id: 024
title: Remove the unread global import flag
scope: backend-api-persist
status: implemented
---

The import hook writes a global importing flag, subscribes to identity scope changes to reset it, and returns it. Its sole production caller reads only importModel. The flag does not serialize imports; request guards and the import path own safety.

Delete the flag/setter, scope-reset subscription, hook subscriptions, and returned field. Keep the mutation, import operation, and scope guards. Future loading status should derive from React Query rather than a parallel boolean.

## References

- `frontend/src/state/useServerModelImport.ts:12-19,38-56` maintains the unread state.
- `frontend/src/state/uiStore.ts:13,16,41,44,64` defines/resets it.
- `frontend/src/app/ServerWorkspaceRecovery.tsx:27` reads only importModel.

## Verification

Implementation verified by import/recovery tests and local cleanup checks recorded in README.

Check production consumers. Run import/recovery tests for success, failure, concurrent-operation rejection, and scope transitions, plus typecheck. Keep old-scope response protection and financial write serialization.
