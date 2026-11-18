---
id: 042
title: Share one pattern test seed
scope: deploy-build-test
status: accepted
---

The sqlite suite builds the same three-observation world twice (`seedRecurringEvidence` vs `seedPaymentEvidence`, `completePatternAnalysis` vs `completePaymentAnalysis`), and the integration suite repeats the same translate/reconcile/claim/complete seed (`seedAPIRecurringPattern` at `analysis_pattern_to_new_rule_test.go:18-58` vs `seedAPIPaymentPattern` at `analysis_pattern_payment_test.go:14-58`). Shared plumbing (`callAPI`, `confirmAPIFinding`, `confirmFinding`) lives in feature files instead of the shared harness, so deleting one test file silently breaks another.

Merge into one parameterized seed (kind, cadence, description, amount, provider, role) in a shared test helper, and move shared HTTP helpers next to `openAPIStore` in `helpers_test.go`.

Verify with `go test ./backend/internal/store/adapters/sqlite -run 'Pattern|Payment'` and `go test ./backend/internal/api/integration -run 'Pattern'`.

References: `backend/internal/store/adapters/sqlite/analysis_pattern_to_new_rule_test.go:12-80`; `backend/internal/store/adapters/sqlite/analysis_pattern_payment_test.go:11-62,68,112`; `backend/internal/api/integration/analysis_pattern_to_new_rule_test.go:18-80`; `backend/internal/api/integration/analysis_pattern_payment_test.go:14-58,139`; `backend/internal/api/integration/helpers_test.go:27`.
