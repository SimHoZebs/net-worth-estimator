# Technical Overview Names the Wrong Chart Library

Severity: Low

## Evidence

- `TECHNICAL_OVERVIEW.md:8` lists Recharts.
- `package.json` depends on `uplot` and does not depend on Recharts.
- Active chart components use `UPlotChart` and uPlot configuration helpers.

## Impact

The architecture guide sends maintainers toward the wrong library and can lead to incorrect assumptions about rendering and performance behavior.

## Minimal Recommendation

Replace the Recharts reference with uPlot and mention the shared adapter in `src/components/ui/UPlotChart.tsx`.

## Verification

- Search project documentation for other stale Recharts references.
- Confirm documented dependencies match `package.json`.
