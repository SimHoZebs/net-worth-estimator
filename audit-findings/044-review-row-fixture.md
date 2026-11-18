---
id: 044
title: Share one review-row fixture in the frontend test
scope: deploy-build-test
status: accepted
---

`patternReview.test.ts` rebuilds the same payment plus recurring group in almost every test through local `payment()`, `recurring()`, and `row()` factories (`:14-66`, rebuilt at `:68-80` and `:127-134`). This is local duplication, not cross-layer bloat.

Extract one shared `makeReviewRow()` fixture. Keep the literal chip and label assertions (`income?`, `Repeating`, `Monthly`, `Awaiting analysis`) since they pin user-facing copy.

Verify with `vitest run src/domain/patternReview.test.ts`.

References: `frontend/src/domain/patternReview.test.ts:14-66,68-80,127-169`.
