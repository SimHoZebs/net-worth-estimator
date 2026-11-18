---
id: 056
title: Fix stale numbers in pattern docs
scope: doc-audit-reference
status: accepted
---

`payment-patterns.md:101` states a fixed 8,192-bucket feature space while `ml/README.md:5` says interactions hash into 32,768 buckets after growing from 8,192. `backend/scripts/one-time/payment-patterns/README.md:20` tells the operator to verify fresh `payments-v2/` findings while `payment_patterns.go:17` defines `PaymentPatternsVersion = "payments-v3"`.

Replace the hard number with a pointer to `ml/README.md` (or restate 32,768) and bump the operator README to `payments-v3` (or say current `PaymentPatternsVersion`).

Verify grep for `8192|8,192` across `docs/` and `ml/` shows no stale hits and the README version matches the constant.

References: `docs/payment-patterns.md:101`; `ml/README.md:5,32`; `backend/internal/analysis/payment_patterns.go:17`; `backend/scripts/one-time/payment-patterns/README.md:20`.
