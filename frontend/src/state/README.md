# State ownership

Choose the owner from the data's authority and lifetime, not its number of readers.

| State                                                                    | Owner                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Saved model, revision, status, and amount recipes                        | TanStack Query, through `workspaceResources.ts`      |
| Saved evaluation pins                                                    | TanStack Query, through `pinnedEvaluations.ts`       |
| Saved budget settings and optimistic updates                             | TanStack Query, through `useSafeSpendingSettings.ts` |
| Projection results and stochastic stream snapshots                       | TanStack Query                                       |
| Save/import/recipe mutation status and errors                            | TanStack Query, through `workspaceWrites.ts`         |
| Shared unsaved plan, comparison baseline, browser draft-storage errors   | Zustand, through `workspaceStore.ts`                 |
| Theme preference, projection controls, shared UI coordination            | Zustand                                              |
| Unsubmitted form fields, selected IDs, drag previews, search, pagination | Local React state                                    |

Screens read server data through `useServerModel`, `useServerStatus`, and
`useAmountPresets`. `usePlan` chooses the local draft or Query's current plan.
There is no combined store interface or cached combined snapshot.
The draft store retains a comparison baseline only while a draft exists.
Revision conflicts derive from the draft's recorded identity and Query's model.

Every financial query key includes the verified resource scope. Resource changes
cancel old queries and clear private data. A same-owner verification can retain
completed results. Workspace snapshots remain cached for the session.

Explicit refreshes wait for pending saves. Query owns request cancellation,
deduplication, loading state, and mutation state. Draft edits check the current
Query lifecycle and revision before they apply. Component unmount does not replay
or cancel a server write. Resource checks reject results from retired sessions.

Pins use ordered optimistic mutations with rollback. Budget settings use ordered
optimistic mutations with explicit retry of the latest value. The browser budget
record serves only as a one-time import for its verified owner.

Keep selection as an ID. Resolve records from the current plan or projection.
Local form edits override current values only for edited fields. A same-field
external change requires explicit conflict recovery before submission.

For another server preference or server collection, add a resource-scoped query
and mutation. Do not add a Zustand cache, timestamp, or duplicate loading state.
