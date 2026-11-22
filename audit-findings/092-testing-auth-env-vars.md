---
id: 092
title: Remove the nonexistent auth variables from the test matrix
scope: doc-audit-reference
status: accepted
---

## Scenario

Server startup is not a user screen. An operator starts the API with a set of environment variables, name-and-value settings passed to the process before it runs. The identity configuration helper reads those settings at boot, before the server accepts any request, and assembles them into the settings used to verify who is calling. One setting names the authentication provider, the external identity service that issues and verifies user sessions. A shared Authorization bearer header is a credential sent with a request, but it cannot replace a session or bypass a denied permission. The helper rejects any provider name other than the supported one, so a bad value is a startup failure and no visible result follows; this is why the exact variable name matters. The test matrix in the testing guide is the reference an operator follows when bringing up a test stack.

That matrix claims two unprefixed names make startup fail. Neither name drives startup. One of them appears nowhere in application code, and the real setting is the prefixed provider name, where only a value other than the supported provider causes failure. Setting the two names as written is ignored and the server starts normally.

## Executive summary

The testing guide says that setting `AUTH_TOKEN` and `AUTH_PROVIDER=none` makes server startup fail. Neither name drives startup. `AUTH_TOKEN` appears nowhere in application code, and the real variable is `NET_WORTH_ESTIMATOR_AUTH_PROVIDER`, where only a value other than `better-auth` causes failure. Setting the two names as written is ignored and the server starts normally. The claim is false and invites wrong deployment configuration, so it should be removed.

## Recommended action

Drop the clause from the testing guide. The preceding sentence already states the bearer rule, so no replacement text is required. If the condition is worth keeping, state the real one, a `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` value other than `better-auth`, and point to the auth guide as the owner. No code change is needed.

## Before and after

| | Statement in the test matrix |
|---|---|
| Before | `AUTH_TOKEN` and `AUTH_PROVIDER=none` cause server startup to fail |
| After | Remove the clause; if kept, the real condition is a `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` value other than `better-auth`, owned by the auth guide |

```mermaid
flowchart LR
  subgraph before[Before]
    A[AUTH_TOKEN and AUTH_PROVIDER=none claimed to fail]
  end
  subgraph after[After]
    B[Prefixed provider other than better-auth fails]
    C[Unprefixed names ignored, server starts]
  end
```

## Expected improvement

The test matrix no longer tells operators to set variables that the server ignores, so deployment configuration guidance stops pointing at names that do nothing. This is a documentation-accuracy improvement rather than a measured speed or size gain; no benchmarks were run for this finding.

## Alternatives considered

- Leave as is. Readers may configure deployments with names that have no effect, and the false failure claim persists. Rejected.
- Add support for the unprefixed names in code. That would create new configuration behavior to satisfy a documentation error, which is the wrong direction for this finding. Rejected.

## Downside of rejecting

The false claim remains in the matrix, so an operator following it sets variables that are ignored and believes startup will fail when it will not. The real condition, a non-`better-auth` value on the prefixed variable, stays undocumented at this site.

## Verification

Grep for `AUTH_TOKEN` and `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` across source and docs. Confirm the startup-fail path reads only the prefixed variable. These are proposed acceptance checks, not recorded results.

References: `TESTING.md:338`; `backend/internal/identity/config.go:52,64-69`; `backend/internal/identity/config_test.go:21-23`.
