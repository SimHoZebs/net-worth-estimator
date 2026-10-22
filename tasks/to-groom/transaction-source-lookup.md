# Transaction activity: look up each source once

The result adapter searches one-time and scheduled transaction definitions twice per activity entry: once for its endpoints and again for its name. Long projections repeat those searches for many occurrences of the same scheduled transaction.

Build one short-lived ID lookup inside `projectionResultToLocal`, the server-result-to-display adapter. Resolve each source once and pass it to name and endpoint mapping. Replace the repeated searches, not the server's amount or constraint calculations.

- Searches and consumers: `frontend/src/state/useRemoteProjection.ts:370-418,535-571`.
- Existing mapping tests: `frontend/src/state/remoteHooks.test.ts:1575-1715`.

Verify full mapped-result equality, repeated occurrences, unknown IDs, one-time-before-scheduled lookup preference, multiple destinations, and missing account-change fallbacks. This removes repeated linear searches during adaptation. Runtime improvement remains unmeasured.
