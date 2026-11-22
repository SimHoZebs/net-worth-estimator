---
id: 069
title: Correct the projection source comment
scope: backend-api-persist
status: accepted
---

## Scenario

When the Outlook forecast or the Evaluations page opens, the browser asks the API for a single-shot projection to draw the net-worth chart and the current amounts; nothing can be displayed until the reply arrives. The request is `POST /v1/projections/deterministic` with operation `project-deterministic`, and its JSON body carries the projection settings and an inclusive ISO date range. The API replies with a JSON result body and one response header named `Projection-Source`, meaning a small piece of metadata sent alongside the body. The header carries deliberately one of two words: `computed` or `shared`. `computed` marks a result derived from the canonical model, meaning the model the API loads from its own store when the request supplies neither a model nor overrides. `shared` marks attachment to an in-flight stochastic run started by another request. The header tells the browser whether the numbers came from this request's own work or from work another request started.

The manual checks in `TESTING.md` state that a deterministic request, meaning one with no request-supplied model and no overrides, always reports `Projection-Source: computed`. For such a request the API first tries `readDeterministic`, which assembles the answer from stored slices, timeline rows, and evaluation outputs produced by an earlier build; only when that stored build is missing or stale does the handler compute the projection directly. A short comment beside the `computed` constant in `backend/internal/api/projections/deterministic.go` is the only in-code explanation of this rule, and the wording this finding targets says that no stored results exist. A maintainer who reads that comment can conclude the read-and-build path is dead code. The fix changes the comment only; the header values stay as they are.

```mermaid
flowchart LR
  A[You open Outlook forecast or Evaluations] --> B[Browser sends POST /v1/projections/deterministic with project-deterministic, settings and ISO range]
  B --> C[No model or overrides, so API tries readDeterministic]
  C --> D[Stored slices, timeline rows, and evaluation outputs are assembled]
  D --> E[Net-worth chart and amounts appear with Projection-Source: computed]
  C -. comment claims no stored results .-> F[Maintainer may treat read-and-build as dead code]
```

## Executive summary

The `Projection-Source` header tells the client where a projection result came from and is deliberately single-valued: `computed` or `shared`. The constant for `computed` was documented as claiming that every projection computes directly and that no stored results exist. That comment is wrong. The file's own canonical read path first tries `readDeterministic`, which assembles a result from stored slices, rows, and evaluation outputs and labels that cache hit `computed`.

`TESTING.md` states deterministic requests always report `computed`, so this is not a request to change the wire contract. It is a stale comment that would lead a maintainer to treat the whole read-and-build path as dead code. The fix is to correct the comment to describe what the code actually does.

## Recommended action

Rewrite the comment so it says `computed` marks a result derived from the canonical model, whether computed on this request or assembled from a stored build, and that only `shared` marks attachment to an in-flight stochastic run. Leave the constant values and the `TESTING.md` statement unchanged.

## Before and after

| | Before | After |
|---|---|---|
| Comment | Claims no stored results exist | Says `computed` covers fresh computation and a stored build |
| Code | `readDeterministic` assembles a stored build | Unchanged |
| Header values | `computed` / `shared` | Unchanged |

```mermaid
flowchart LR
  subgraph Before
    B1["Comment: no stored results"] --- B2[readDeterministic assembles a stored build]
  end
  subgraph After
    A1["Comment: computed means canonical-model result"] --- A2[readDeterministic assembles a stored build]
  end
```

## Expected improvement

The comment no longer contradicts the live read path, so a maintainer is less likely to delete code that deterministic results depend on. This is a documentation-only, structural improvement with no behavior change. No benchmarks were run, so no speed or size benefit is claimed.

## Alternatives considered

- **Leave as is** — the comment keeps implying the read-and-build path is dead, inviting someone to remove it.
- **Change the header contract** — rejected, because the header is deliberately single-valued and `TESTING.md` relies on deterministic requests reporting `computed`.

## Downside of rejecting

The stale comment stays in place. A maintainer reading it can conclude the stored-build orchestration is unnecessary and remove it, which would break the deterministic results that currently come from assembled stored slices, rows, and evaluation outputs.

## Verification

Run `go test ./backend/internal/api/projections/...` and grep to confirm no source still claims stored results do not exist. No header value should change.

References: `backend/internal/api/projections/deterministic.go:15-19,66-88`; `backend/internal/api/projections/stochastic.go:174-177`; `TESTING.md:305,323`.
