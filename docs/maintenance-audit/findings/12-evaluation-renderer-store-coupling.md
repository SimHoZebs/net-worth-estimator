# Evaluation Renderer Has a Hidden Store Dependency

Severity: Low

## Evidence

- `src/components/evaluations/EvaluationList.tsx:28-45` defines a result renderer contract containing data-oriented props.
- `src/components/evaluations/FinancialIndependenceEvaluation.tsx:37-75` imports Zustand directly to update configuration.
- Other configuration editing is coordinated by `EvaluationList`.

## Impact

The registry contract does not describe all renderer dependencies. The financial-independence renderer is harder to reuse and test with isolated state.

## Minimal Recommendation

Add a configuration-change callback to the renderer contract and pass it from `EvaluationList`. Keep the store subscription at the feature owner.

## Verification

- Render the financial-independence evaluation with callbacks and no store mutation dependency.
- Confirm configuration changes still update the correct evaluation instance.
