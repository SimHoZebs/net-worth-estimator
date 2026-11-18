---
id: 054
title: Fix row and forecast list composition
scope: ui-ux
status: accepted
---

The review row renders `Item variant="outline"` as a button containing `ItemContent > ItemTitle(div)` plus `ItemDescription(p)` (`PatternReview.tsx:472-524`): div plus p inside button is invalid phrasing content. Conversely `ForecastRows` uses interactive `Item` plus `ItemGroup` plus `ItemSeparator` for static label-value display (`RecurringPatterns.tsx:190-204`), inheriting hover and focus styles it never needs.

Keep `Item` for genuinely interactive rows only. Make the review row a plain button with flex layout (or `Item` with valid phrasing children) and convert forecast rows to `dl`/`div` rows.

Verify DOM shows no div/p inside button, axe check passes, and focus rings appear only on the review row.

References: `frontend/src/components/analysis/PatternReview.tsx:472-524`; `frontend/src/components/analysis/RecurringPatterns.tsx:190-204`.
