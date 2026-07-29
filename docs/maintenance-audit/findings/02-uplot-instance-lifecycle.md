# uPlot Instances Are Recreated on Data Updates

Severity: High

## Evidence

- `src/components/ui/UPlotChart.tsx:57-127` constructs and destroys the chart in an effect that depends on `data`.
- `src/components/ui/UPlotChart.tsx:134-136` separately calls `setData(data)`.
- `src/hooks/useStochastic.ts:66-75` emits progressive partial results, producing repeated chart data changes.

## Impact

Each stochastic progress batch can recreate the chart, hooks, DOM, and `ResizeObserver`. This creates avoidable allocation and can reset cursor or tooltip state.

## Minimal Recommendation

Construct the uPlot instance only when structural options change. Handle ordinary data changes exclusively with `chart.setData(data)`.

## Verification

- Add a component test or instrumentation proving data updates do not call `destroy` or construct a second chart.
- Confirm option changes still rebuild when required.
- Profile a progressive stochastic run.
