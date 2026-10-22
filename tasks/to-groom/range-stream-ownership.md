# Outlook range and evidence: give each view its own stream

Outlook and an evidence view can request the same seeded range, such as `400` scenarios with seed `42`. The browser shares one query promise, but its intermediate-result callbacks and cancellation belong to the first view. Other views receive only the final result and can lose their transport when that first view closes.

Open one server stream per mounted consumer through the existing range client and parser. Remove range-specific browser promise sharing, its key helper, and shared-owner abort recovery. The server already shares seeded calculations and supports independent stream attachment/detachment. Base-case browser caching is a separate mechanism.

- Browser sharing and cancellation: `frontend/src/state/useRemoteProjection.ts:865-967`.
- Second consumer: `frontend/src/workspace/WorkspaceDialogs.tsx:16-47`.
- Server attachment/replay: `backend/internal/api/stochastic_sse.go:99-119,283-296,309-381`.
- Incomplete abort test: `frontend/src/state/remoteHooks.test.ts:2194-2236`.

Test two consumers with a genuinely pending `ReadableStream`. Send an intermediate result and verify both update. Close either view and verify the other completes. Cover errors and seeded/unseeded cancellation rules. The tradeoff is more HTTP requests and response decoding, not more seeded calculations. Latency and net savings remain unmeasured.
