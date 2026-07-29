# External Payloads Are Asserted Rather Than Validated

Severity: Medium

## Evidence

- `src/lib/projection/sources/csv/csvDataSource.ts:28,58` asserts API JSON as `FinancialModelParseResult`.
- `src/engine/WorkerProjectionEngine.ts:53-59,127-149` trusts typed worker event payloads without runtime guards.
- Worker entry points similarly receive compile-time request types directly from `event.data`.

## Impact

Malformed API responses can enter application state as valid domain data and fail later with less useful errors. Worker payload risk is lower because the application controls both sides, but transport contracts still lack runtime discrimination.

## Minimal Recommendation

Parse API JSON as `unknown` and validate its result shape before returning it. Add lightweight worker response guards for the message discriminator and required result/error fields.

## Verification

- Test malformed, partial, and unexpected API responses.
- Test unknown worker message types and missing fields.
- Preserve controlled error messages at query and worker boundaries.
