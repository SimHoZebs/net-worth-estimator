# Worker Lifecycle Logic Is Duplicated

Severity: Medium

## Evidence

- `src/engine/WorkerProjectionEngine.ts:25-93` implements deterministic worker setup and cleanup.
- `src/engine/WorkerProjectionEngine.ts:96-184` repeats creation, abort, cleanup, transport error, and post failure handling.
- `src/hooks/useProjection.ts` and `src/hooks/useStochastic.ts` also duplicate request identity, abort, stale-result, and lifecycle state mechanics.

## Impact

Abort, cleanup, and error behavior must remain aligned across four implementations. Future transport changes can fix one path while leaving another inconsistent.

## Minimal Recommendation

Extract a private worker request foundation for identical transport mechanics and a private hook lifecycle foundation only if it keeps the specialized public hooks clear. Do not replace the public methods with a flag-heavy generic API.

## Verification

- Preserve existing `ProjectionEngine` and hook call sites.
- Run worker engine and hook tests.
- Test abort before posting, abort during work, message errors, worker crashes, and progress callback failure.
