---
id: 055
title: Correct the payment registry docs
scope: doc-audit-reference
status: accepted
---

`payment-patterns.md:5-6` says income and rent are the registry definitions, but `payment_classifications.go:38-45` registers five: income, rent, utility, auto-insurance, card-payment. The same doc says purpose definitions can select an external evidence view with income and rent doing so (`:29-30`), while every definition sets `ExternalOnly: true` (filter at `payment_patterns.go:177-178`). Rent lists only card, mortgage, and non-rent exclusions (`:62-67`) while its five `ExcludeSignals` include utility-descriptor and insurance-descriptor surfaced in other sections, and generic `insurance`/`insurer` (`payment_classifications.go:64`) never appear in the word list (`:82-84`). `TERMS.md:69-74` also still calls the result income-pattern Analysis while code returns `Type() = "payments"`.

Update the intro to the five-definition registry (or link the registry as owner), state all current definitions are external-only, add one exclusion table to Boundaries matching `ExcludeSignals` exactly, and correct TERMS to the `payments` analysis type.

Verify the enumeration, flags, and table match `PaymentClassifications()` output.

References: `docs/payment-patterns.md:5-6,29-30,62-87`; `backend/internal/analysis/payment_classifications.go:38-64`; `backend/internal/analysis/payment_patterns.go:31,177-178`; `docs/TERMS.md:69-74`.
