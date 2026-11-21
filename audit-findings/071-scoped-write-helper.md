---
id: 071
title: Share the scoped fetch and write lifecycle
scope: frontend-state
status: accepted
---

Five state modules independently rebuild the same three operations against the shared query client. A `current(scope, signal)` identity guard is written verbatim in Gmail and sync settings and nearly verbatim in workspace resources. `runMutation` captures the scope, returns null when pending, builds a mutation with `mutationKey` and a `scope: { id: JSON.stringify(key) }` marker, executes, guards the result, and notifies with a fixed error message; Gmail and sync settings carry byte-for-byte copies while pinned evaluations, safe-spending settings, and the `write` helper in workspace writes rebuild the same skeleton inline to add optimistic values or rollback. `refreshX(force)` returns when pending, optionally invalidates with `refetchType: "none"`, then fetches, and appears twice each in Gmail and sync settings plus integrations, pinned evaluations, and purchases.

Add one helper module exposing `runScopedMutation({ key, mutationFn, onError })` and `fetchScopedQuery(options, force)` with the identity guard inside it. Make the two `runMutation` functions delegate first, then convert the inline builders and the six `refreshX` functions. The endpoint call and refresh or error policy stay at each call site.

Verify that the existing Gmail, sync, pins, purchases, and safe-spending tests pass unchanged, then add a case that switches resource mid-write and mid-refresh and asserts no result is published to the new scope, plus a case that a forced refresh replaces data inside the 30-second stale window while a normal refresh serves cache. Keep mutation visibility intact where `isMutating` or `useMutationState` reads these keys.

References: `frontend/src/state/gmail.ts:31-34,52-67,69-98,182-196`; `frontend/src/state/syncSettings.ts:42-45,97-122,124-153`; `frontend/src/state/integrations.ts:45-59`; `frontend/src/state/pinnedEvaluations.ts:46-59,66-93`; `frontend/src/state/useSafeSpendingSettings.ts:152-219,221-239`; `frontend/src/state/workspaceWrites.ts:162-205`; `frontend/src/state/purchaseWrites.ts:155-166`; `frontend/src/state/workspaceResources.ts:61-64`.
