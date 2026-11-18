---
id: 058
title: Correct the learner privacy sentence
scope: doc-audit-reference
status: accepted
---

`payment-patterns.md:47` says the shared learner shares learning, never owner bank facts or saved answers. Requests actually carry up to three original `TransactionFacts` (`payment_evidence.go:28-31`), feedback pages carry the original request including those samples (`payment_provider.go:136-155`), and `judgment-providers.md:94-100` warns evidence includes sensitive descriptions limited to localhost plus private networks. `ml/README.md:5` guarantees stored bank evidence, findings, and saved decisions remain user-scoped while the model learns from everyone's feedback.

Reword to that formulation: shared learning from explicit answers, stored bank evidence plus decisions stay owner-scoped, request-sample transport covered by the localhost rule. Owner for this fact is `judgment-providers.md` Privacy.

Verify the revised sentence matches `judgment-providers.md:94-105` and `ml/README.md:5`.

References: `docs/payment-patterns.md:47`; `backend/internal/analysis/payment_evidence.go:28-31`; `backend/internal/analysis/payment_provider.go:136-155`; `docs/judgment-providers.md:94-105`; `ml/README.md:5`.
