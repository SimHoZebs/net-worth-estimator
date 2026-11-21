---
id: 092
title: Remove the nonexistent auth variables from the test matrix
scope: doc-audit-reference
status: accepted
---

`TESTING.md` claims that `AUTH_TOKEN` and `AUTH_PROVIDER=none` cause server startup to fail. `AUTH_TOKEN` appears nowhere in application code, and the real variable is `NET_WORTH_ESTIMATOR_AUTH_PROVIDER`; only a value other than `better-auth` for that prefixed variable fails. Setting the two names as written is ignored and the server starts normally, so the claim is false and invites wrong deployment configuration.

Drop the clause — the preceding sentence already states the bearer rule — or state the real condition with a pointer to the auth guide as owner.

Verify with a grep for `AUTH_TOKEN` and `NET_WORTH_ESTIMATOR_AUTH_PROVIDER` across source and docs; the startup-fail path must read only the prefixed variable.

References: `TESTING.md:338`; `backend/internal/identity/config.go:52,64-69`; `backend/internal/identity/config_test.go:21-23`.
