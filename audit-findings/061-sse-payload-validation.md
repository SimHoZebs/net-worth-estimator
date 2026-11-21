---
id: 061
title: Validate stream event payloads before typing them
scope: contracts-types
status: needs-review
---

Server-sent events are the one external JSON boundary in the client that parses data and then casts it straight to a typed domain shape. `parseBlock` checks only that `data` is an object, and `dispatchEvent` passes it through `eventPayload<T>`, a bare `as T`, to typed callbacks. Consumers immediately dereference nested fields such as `data.progress.fraction`, `data.result`, and `data.error`. The backend marshals arbitrary `any` payloads and the OpenAPI spec types the stream as a plain string, so no generated schema protects this path. A field rename or malformed event reaches domain code as a valid-looking object and fails as a confusing downstream error or a wrong progress value.

Validate each event payload once at the parse boundary, using the existing guards in `domain/guards.ts` to narrow `unknown` to the corresponding event shape for `progress`, `partial`, `result`, and `error`. Invoke the typed callbacks only after that check and report a shape mismatch through `SSEParseError` so the existing parse-error path handles it.

Verify that a malformed event such as `{"event":"result","data":{"foo":1}}` fires `onParseError` and runs no typed callback, while valid progress, partial, result, and error events still drive the stream to a completed range. `sse.test.ts` and the stochastic query tests cover the valid paths.

References: `frontend/src/api/sse.ts:53-69,107-116`; `frontend/src/state/stochasticProjectionQuery.ts:62-81`; `backend/internal/api/projections/stochastic.go:40-53`; `backend/internal/api/projections/routes.go:46`.
