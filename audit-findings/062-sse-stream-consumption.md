---
id: 062
title: Use one stream consumption loop
scope: frontend-state
status: accepted
---

## Executive summary

`parseSSE` accepts strings, `Response`, `ReadableStream`, and `AsyncIterable`. Its `consumeReader` and `consumeAsyncIterable` repeat the same loop: abort check, feed, parse-error check, `catch` mapping to `SSEParseError` or `SSETransportError`, and a `parser.finish()` tail. The string branch repeats that finish tail, so the step exists three times.

Inside `SSEParser`, `feed` and `finish` repeat the same `parseBlock` error conversion and dispatch. The exports `push`, `end`, and `createSSEParser` are unused aliases of `feed`, `finish`, and the constructor. A change to abort or error semantics currently has to be made in several places. The recommendation is one consumption loop for every transport.

## Recommended action

Wrap a reader or `Response` as an async iterable of chunks and keep one consumption loop for all transports, with a single finish helper. Factor the parsed-block application so `feed` and `finish` call it instead of duplicating the error conversion and dispatch. Delete the three unused aliases `push`, `end`, and `createSSEParser`. No new behaviour is introduced.

## Before and after

Before: reader, async iterable, and string transports each carry a copy of the loop or its finish tail, and `feed` and `finish` duplicate the parsed-block handling.

After: one consumption loop serves all transports with one finish helper, and `feed` and `finish` share one parsed-block application.

```mermaid
flowchart LR
  A[reader loop] --> C[one consumption loop]
  B[async iterable loop] --> C
  D[string finish tail] --> C
```

## Expected improvement

Abort and error semantics live in one place instead of several, so a future change is made once and applies to every transport. This is a structural improvement to maintainability, not a measured improvement; no benchmark or timing was run.

## Alternatives considered

- Leave as is: rejected because the repeated loop and finish tail mean an abort or error change must be applied in several places and can be missed in one.
- Consolidate only the transport loops and keep the aliases: rejected because the unused aliases and the duplicated parsed-block handling remain as separate places that can drift.

## Downside of rejecting

The three copies of the loop or finish tail stay, so abort or error changes keep needing parallel edits and can be applied inconsistently across transports, and the unused aliases continue to suggest public entry points that do nothing distinct.

## Verification

Verify with cases for `Response`, `ReadableStream`, and `AsyncIterable`, including abort mid-stream and malformed JSON, that callback order, error classes, and `releaseLock` cleanup stay identical after the consolidation. `sse.test.ts` already covers strings and incremental feed/finish. These are proposed acceptance checks; no result was recorded.

References: `frontend/src/api/sse.ts:145-197,199-210,212-263,271-276`.
