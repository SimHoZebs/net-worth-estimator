---
id: 051
title: Share one forecast-schedule action pair
scope: ui-ux
status: accepted
---

`RepetitionActions`, `PaymentForecastActions`, and the recurring branch of `TransactionInsightsPanel` each render the same two buttons (create forecast schedule plus link to existing schedule) and each mount their own dialog open-state pair. Labels already drift (`Review forecast plan` vs `Create forecast schedule` at `PatternReview.tsx:188,260`, aria labels at `:197,269`, plus `TransactionInsights.tsx:600,612` glue).

Merge into one `ForecastScheduleActions({ findingId, titles, readOnly })` in `RecurringPatterns.tsx`. Callers keep only their extra answers (`Not repeating`, `Review again`). Pass explicit eyebrow plus heading values from one vocabulary instead of mixing defaults (`RecurringPatterns.tsx:46,212`) with payment `kindLabel` overrides (`PatternReview.tsx:280,290`).

Verify both repeating and payment rows show identical order, labels, and dialog titles, and focus returns to the invoking button on close.

References: `frontend/src/components/analysis/PatternReview.tsx:188,197,260,269,280,290,321`; `frontend/src/components/analysis/RecurringPatterns.tsx:46,71,212,248`; `frontend/src/components/activity/TransactionInsights.tsx:600,612`.
