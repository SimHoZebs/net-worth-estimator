# Performance Audit: Recharts in Net Worth Estimator

## Methodology

All measurements were collected using the React DevTools Profiler (React 19) during a representative Monte Carlo simulation run with no user interaction (no mouse movement, no keystrokes, no scroll). The profiled interaction captures the full streaming pipeline: projection worker execution, progressive result delivery, and chart re-rendering across 1,000 simulation runs.

## Measured Cost

| Metric | Value |
|--------|-------|
| Commits during single MC run | ~150 |
| Recharts-related commits | ~90 (60%) |
| Time spent in Recharts subtree | ~4,900ms (54% of total render time) |
| Average chart commit duration | ~54ms |
| Worst chart commit duration | 99ms |
| Commits exceeding 16.7ms frame budget | 147/149 (99%) |

The chart is the single most expensive component in the application, accounting for the majority of render time during the application's primary interaction model (simulation streaming).

## Root Cause: Full SVG Reconciliation on Every Data Change

Recharts builds an SVG DOM tree and re-renders it on every data change. The current chart renders approximately **12 Recharts sub-components** per commit:

| Component | Count | Role |
|-----------|-------|------|
| `CartesianGrid` | 1 | Background grid lines |
| `XAxis` / `YAxis` | 2 | Tick labels, lines, domain calcs |
| `Area` (stacked) | 4 | P10/P90 outer band, P25/P75 inner band |
| `Line` | 1-10+ | Main projection (stochastic/deterministic) + per-account lines |
| `ReferenceLine` | 1-3 | Target net worth, milestone markers |
| `Legend` | 1 | Series label rendering |
| `Tooltip` | 1 | Hover interaction handler |
| `EventSynchronizer` | 1 | Internal cross-component event coordination |

Each sub-component, when the data changes, undergoes React reconciliation followed by SVG DOM mutation. For a chart with 100+ data points and multiple series, this reconciliation is inherently expensive — ~54ms per commit even without animation.

## Attempted Optimizations and Their Limits

### What worked
- **Disabling animation gating**: Reduced replay-induced commits from 253 to ~6 per session.
- **React.memo on chart boundary**: Prevents re-renders when no prop changes. Verified working.
- **Stabilizing prop references**: `useMemo` on chart data, `useCallback` on handlers, stable label objects. Verified working.

### What hit a ceiling
- **Reducing commit count**: Impossible to reduce further because every Monte Carlo progress callback *genuinely* changes the chart data. The user should see the simulation converging, so we cannot batch or skip these updates.
- **Reducing per-commit cost**: ~54ms is the floor for SVG reconciliation of this many series and data points in Recharts. No React-level optimization can make the SVG layout engine faster.
- **Alternative renderers within Recharts**: Recharts wraps Recharts SVG components — there is no canvas mode, no partial update mode, no skip-reconciliation-for-unchanged-series mode.

## Why This Is a Ceiling

The fundamental limitation is architectural: Recharts rebuilds SVG content from scratch on every data change. This model works well for low-frequency updates (click-through visualizations, static dashboards) but breaks down for interactive streaming where data changes multiple times per second.

The application's core value proposition — watching a Monte Carlo simulation converge in real time — directly conflicts with Recharts' render model. Every new data point, every narrowed confidence interval, every progress milestone forces a full SVG reconciliation pass that exceeds the 16.7ms frame budget by 3-6x.

## Recommendation

The optimizations in this codebase have extracted all meaningful performance improvements available within Recharts' rendering model. Further optimization work on the current stack will yield diminishing returns. The engineering team should research charting alternatives that support:

- Incremental / patch-style updates (append data without full re-render)
- Canvas or WebGL rendering (decouple chart complexity from DOM cost)
- Streaming-first data pipelines (designed for real-time partial updates)
- Sub-millisecond per-update render cost at this series count and data density
