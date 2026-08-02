# Performance Audit: uPlot Projection Dashboard

## Current Shape

The dashboard uses uPlot with direct data updates, explicit chart cleanup, and worker-backed deterministic and Monte Carlo computation. Progressive stochastic results intentionally update the dashboard so users can see convergence.

The main production bundle should remain monitored because route pages and heavy dashboard components can otherwise be pulled into the initial chunk. Route-level lazy loading is enabled in `src/main.tsx`; build output should be inspected for regressions rather than relying on raw source size.

## Measurement Guidance

Profile representative models with:

- 15-year deterministic projections
- 1,000 and 10,000 Monte Carlo runs
- Large account and posting counts
- Progress streaming enabled
- Both reduced-motion and normal-motion preferences

Record initial JavaScript transfer, chart update duration, worker time, and main-thread blocking. Optimize only after identifying a measured bottleneck.

## Known Boundaries

- Projection and stochastic computation run in Web Workers.
- uPlot owns canvas rendering and is destroyed on unmount or option changes.
- Projection progress is exposed separately from result artifacts to limit unrelated rerenders.
- Lazy sections defer expensive dashboard rendering, while route imports defer page downloads.
- Source maps are not served from `dist/`; production error reporting should upload private maps if an error-tracking service is introduced.
