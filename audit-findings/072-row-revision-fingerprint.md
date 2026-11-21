---
id: 072
title: Build the saved-row fingerprint in one place
scope: frontend-state
status: accepted
---

`useFlowGraph` and `useCurrentPosition` each define a `take(revision, content, name)` closure inside a `useMemo` that concatenates `name:revision` parts with `|`, falling back to `JSON.stringify(content)`. The closures differ only in one guard. `useRemoteProjection` computes model identity a third way by filtering revisions, deduplicating and sorting them, and joining with `|`. Three hooks therefore derive which saved model is in view with different rules. Today the difference is intentional — current position excludes evaluations because they are backend-owned — but it is expressed by copying the function rather than by an explicit input.

Move the fingerprint builder into `projectionSource.ts` as one function taking the row set, and have both hooks call it with their chosen set of rows. Express the evaluation exclusion in `useCurrentPosition` as an argument, not a modified copy. Leave the projection hook's deduplicated revision scheme alone because it serves a different cache, but name it distinctly so the three are not mistaken for one another.

Verify with fixed saved rows that both hook keys change on the same row revision, and that toggling an evaluation changes the flow-graph key but not the current-position key. Confirm no extra refetch appears in either hook on an unrelated render.

References: `frontend/src/state/useFlowGraph.ts:57-70`; `frontend/src/state/useCurrentPosition.ts:62-80`; `frontend/src/state/useRemoteProjection.ts:611-620`.
