# Confirmed Orphan UI Implementations Remain

Severity: Low

## Evidence

Repository-wide import searches found no consumers for:

- `src/components/dashboard/AccountLinesChart.tsx`
- `src/components/dashboard/StackedContributionChart.tsx`
- `src/components/dashboard/AssumptionList.tsx`
- `src/components/dashboard/CompactDetail.tsx`
- `src/components/dashboard/OutcomeMetric.tsx`
- `src/components/dashboard/StochasticResultCard.tsx`
- `src/components/ui/summary-card.tsx`
- `src/hooks/usePrefersReducedMotion.ts`
- `src/lib/filter-rows.ts`

The four production `as any` assertions are all in the unused stacked chart.

## Impact

Parallel implementations obscure the active design, retain unsafe code, and can attract maintenance or tests that do not affect production behavior.

## Minimal Recommendation

Delete only files confirmed to have no source, test, documentation, or external barrel consumers. Remove the chart overload in `src/chart/uplotBase.ts:87-98` if its only consumer is the orphan chart.

## Verification

- Search all old symbols and paths before deletion.
- Run typecheck, tests, and build.
- Preserve documented scenario compatibility files, which are intentionally retained.
