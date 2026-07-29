# Chart Formatting Is Duplicated and Tests Miss Production Code

Severity: Medium

## Evidence

- `src/lib/format.ts:20-42` exports tested chart currency and date formatters.
- `src/chart/uplotBase.ts:8-37` duplicates both implementations.
- Active chart axes consume the chart-local implementation at `src/chart/uplotBase.ts:69-70`.
- `src/lib/__tests__/format.test.ts` exercises the other copy.

## Impact

Tests can pass while production formatting changes or regresses independently. Behavior can drift between chart and non-chart views.

## Minimal Recommendation

Use the shared tested formatters from `src/lib/format.ts` in chart code and remove the duplicate implementations.

## Verification

- Confirm active chart code imports the shared functions.
- Run formatter and chart tests.
- Check negative, zero, thousand, and million labels.
