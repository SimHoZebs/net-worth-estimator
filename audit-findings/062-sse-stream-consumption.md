---
id: 062
title: Use one stream consumption loop
scope: frontend-state
status: accepted
---

`parseSSE` accepts strings, `Response`, `ReadableStream`, and `AsyncIterable`. Its `consumeReader` and `consumeAsyncIterable` repeat the same loop — abort check, feed, parse-error check, `catch` mapping to `SSEParseError` or `SSETransportError`, and a `parser.finish()` tail — and the string branch repeats that finish tail, so the step exists three times. Inside `SSEParser`, `feed` and `finish` repeat the same `parseBlock` error conversion and dispatch. The exports `push`, `end`, and `createSSEParser` are unused aliases of `feed`, `finish`, and the constructor. A change to abort or error semantics currently has to be made in several places.

Wrap a reader or `Response` as an async iterable of chunks and keep one consumption loop for all transports, with a single finish helper. Factor the parsed-block application so `feed` and `finish` call it, and delete the three unused aliases.

Verify with cases for `Response`, `ReadableStream`, and `AsyncIterable`, including abort mid-stream and malformed JSON, that callback order, error classes, and `releaseLock` cleanup stay identical after the consolidation. `sse.test.ts` already covers strings and incremental feed/finish.

References: `frontend/src/api/sse.ts:145-197,199-210,212-263,271-276`.
