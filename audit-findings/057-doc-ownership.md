---
id: 057
title: Give review mechanics one doc owner
scope: doc-audit-reference
status: accepted
---

Review-queue mechanics (one row per stream, tabs, chips, one dialog with answers plus forecast and visibility actions) live in both `payment-patterns.md:49-58` and `analyses.md:159-183`. Schedule actions (preview, create, link, biweekly-has-no-schedule, same-write acceptance) live compressed in `payment-patterns.md:52-56` and full-length in `analyses.md:227-293`. Judgment plumbing (batches of 100, three observations, one owner session) lives in both `payment-patterns.md:45-48` and `judgment-providers.md:33-36`. `payment-patterns.md:96-105` also mixes deployment prescription, capacity disclaimer, release gate, and refactor history into a semantics doc, and `:50` says one row per stream while code keys groups by stream plus status (`patternReview.ts:67-69`, confirmed by `analyses.md:172`).

Keep full mechanics in one place each (stream plus review in `payment-patterns.md`, provider contract in `judgment-providers.md`, routes in `analyses.md`) with one-line links elsewhere. Move the gate sentence to `release-gates.md`, drop or relocate the Northflank plus refactor-history sentences, and amend the row rule to one row per stream per status.

Verify each fact appears exactly once and the row rule matches the group key.

References: `docs/payment-patterns.md:36-38,45-58,96-105`; `docs/analyses.md:159-183,227-293`; `docs/judgment-providers.md:33-36`; `frontend/src/domain/patternReview.ts:37-91`.
