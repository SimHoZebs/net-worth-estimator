# Range streams: validate payloads before typed callbacks

The stream parser checks that JSON is an object, then casts it to the named event's type. A `progress` event with `{}` reaches code that expects progress fields. Consumers can fail despite the parser's type promise.

Replace the unchecked `eventPayload<T>` cast with event-specific shape decoders. Reuse result decoding for intermediate and final results. Return the existing `SSEParseError` for invalid data and continue forwarding unknown events through the generic callback. Reject empty successful HTTP bodies where JSON is required instead of returning `null as T`.

- Parser and cast: `frontend/src/api/sse.ts:51-67,104-121`.
- Consumers: `frontend/src/state/useRemoteProjection.ts:871-875,894-916`.
- Tests: `frontend/src/api/sse.test.ts:24-76`.
- HTTP cast: `frontend/src/api/client.ts:637-653`.

Test missing progress, invalid fractions, malformed result bands, valid intermediate/final events, unknown events, optional fields, opaque evaluation data, and empty HTTP responses. Overly strict decoding is the main compatibility risk. Stream lifetime belongs to the separate [ownership task](range-stream-ownership.md).
