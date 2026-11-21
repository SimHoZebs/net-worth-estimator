---
id: 080
title: Apply the same judgment response validation to categorization
scope: backend-domain
status: needs-review
---

Payments pass every provider batch through `judgment.Assess`, which rejects duplicate request IDs, missing or mismatched IDs, structurally impossible statuses, and reasons over 2000 bytes. The categorization learner calls `session.Evaluate` directly and accepts a row only on `Status == "ready"` with a strong supported decision, so a duplicate ID or overlong reason passes there and fails in payments. Both run live under the same `ML_JUDGMENT_URL`, so one provider contract has two enforcement points.

Extract the response validation from `Assess` into a reusable helper returning validated decisions plus the deferred error, and call it from `MLClassifier.Classify` before the existing strong-supported filter. Keep keyword-first composition and the rule that the learner may only add labels. If all-or-nothing rejection would drop valid category rows, apply the helper per 100-item batch. This is a correctness fix inside the judgment framework, not a framework removal.

Verify with a table-driven test containing a duplicate `RequestID`, an overlong reason, a ready decision with empty strength, and an unmatched ID: assert no category is assigned and that both paths reject identically. Whether partial batches occur is a product decision that affects the batching choice.

References: `backend/internal/judgment/assess.go:12-62`; `backend/internal/categorization/ml_classifier.go:82-109`; `backend/internal/analysis/payment_judgment.go:17-25`; `docs/analyses.md:188-195`.
