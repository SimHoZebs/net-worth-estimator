---
id: 102
title: Give the retry backoff one documented owner
scope: doc-audit-reference
status: accepted
---

The 30-second retry backoff is implemented once but stated independently in the judgment-providers guide and twice in the analyses guide. The 15-second poll is a distinct value and must stay separate. Four prose sites for one number make a future change easy to half-apply.

Keep the full lifecycle statement in the analyses guide and reduce the judgment-providers mention to a link, without changing the value.

Verify that a `30 second` search across `docs/` resolves to one owning section and that the 15-second poll remains distinct.

References: `backend/internal/store/adapters/sqlite/analysis_runs.go:55`; `docs/judgment-providers.md:56`; `docs/analyses.md:19,194`; `backend/cmd/server/main.go:91`.
