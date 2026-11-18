---
id: 048
title: Memoize pattern grouping
scope: frontend-state
status: accepted
---

`PatternReview` regroups all findings on every render: unmemoized `groupPatternReviews(findings)` plus per-row `reviewTitle`, `reviewAmount`, `reviewCadenceLabel`, `reviewRecordedCount`, and `reviewChips` (`PatternReview.tsx:426-434,467-501`). `AnalysisFindings` also rebuilds the `names` map each render (`AnalysisFindings.tsx:49-51,200`), so even memoized children see unstable props.

Memoize grouped rows keyed on `findings` and memoize the `names` map, reusing the existing `useMemo` precedent in `TransactionDetail.tsx:799-813`.

Verify existing `patternReview.test.ts` suite plus a render check: toggling a row keeps the grouped reference stable when `findings` is unchanged.

References: `frontend/src/components/analysis/PatternReview.tsx:426-434,467-501`; `frontend/src/pages/sources/AnalysisFindings.tsx:49-51,200`.
