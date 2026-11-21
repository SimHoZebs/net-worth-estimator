---
id: 095
title: Correct the error-feedback regression spec inventory
scope: doc-audit-reference
status: accepted
---

The error-feedback guide closes by saying no dedicated error-feedback specs exist and that the only current spec is `selectLabels.spec.ts`. There are twelve spec files at this HEAD, and two of them directly exercise the presentation this doc owns: `outlookLoading.spec.ts` asserts a named alert with a Retry button and its disappearance after retry, and `safeSpendingEvidence.spec.ts` asserts a failure message and "Retry evidence" after a 500. This reopens territory that prior finding 029 partly addressed; that finding removed obsolete references but left an inventory that later additions made stale.

Remove both inventory claims, keep the single-channel and failed-edit retry rules, and point to the integration-suite section of `TESTING.md` for current policy.

Verify that listing `*.spec.ts` files returns twelve and that the two named tests contain the retry assertions.

References: `docs/error-feedback.md:25-27`; `frontend/tests/integration/outlookLoading.spec.ts:3-5,22-33`; `frontend/tests/integration/safeSpendingEvidence.spec.ts:801-826`; `audit-findings/029-current-error-feedback-docs.md:8-10,14`.
