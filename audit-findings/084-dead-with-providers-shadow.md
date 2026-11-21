---
id: 084
title: Delete the dead WithProviders shadow method
scope: backend-domain
status: accepted
---

`PaymentPatterns.WithProviders` is the live extension seam used by the eval harness and tests. `paymentProviderDefinition.WithProviders` shadows it on the prepared definition but has no caller, is absent from the `Definition` interface, and has an unexported receiver. `Prepare` already copies `Providers` into the base value, so the shadow contributes nothing.

Delete only the shadow method and its comment. Keep `ProviderResolver`, `MapProviderResolver`, `enrichStreamsWithProviders`, and the live `PaymentPatterns.WithProviders`: the payment-patterns doc reserves the catalog for later utility and insurance providers and the eval harness exercises the seam.

Verify that a repo-wide `WithProviders` search shows only the live definition, the harness call, and test calls, then run `go test ./internal/analysis/... ./cmd/testing/evalharness/...` from `backend/`.

References: `backend/internal/analysis/payment_provider.go:24-30,52-57`; `backend/internal/analysis/payment_provider_catalog.go:42-47`; `backend/cmd/testing/evalharness/main.go:393-394`; `docs/payment-patterns.md:118-124`.
