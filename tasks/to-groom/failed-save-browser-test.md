# Monthly investing: fail the request the test actually saves

The browser test changes `Monthly investing` from `600` to `900`, but injects failure into posting requests. Saving this scheduled transaction sends `PATCH /v1/recurrence-rules/invest`, so it bypasses the intended failure.

Intercept that exact PATCH request. Assert that the interception fired, the error appears, unsaved changes remain, and the saved expression is still `600`. Reuse the existing saved-plan helper and real fixture API.

- Fixture/test: `frontend/tests/fixtures/model/recurrence-rules.csv:4`, `frontend/tests/workspace.spec.ts:140-168`.
- Actual operation: `frontend/src/api/rowSync.ts:226-237,450-459`, `frontend/src/api/client.ts:516-524`.

Run the corrected failed-save test and the successful-save workflow. This test repair should precede [browser CI wiring](frontend-ci-gates.md). No application change is required.
