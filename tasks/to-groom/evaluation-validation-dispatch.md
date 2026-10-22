# Evaluations: use the registered configuration validator

Each registered evaluation definition already supplies a `ValidateConfig` function, but full-plan validation selects validators through a second type switch. Adding an evaluation therefore requires updating two places for the same decision.

Replace the switch in `validateEvaluationConfigs` with the registered definition's `ValidateConfig` call. Add an explicit failure path for a missing definition or validator, rather than silently skipping it.

- Existing hook: `backend/internal/domain/evaluation_runtime.go:66-67`.
- Duplicate selection: `backend/internal/domain/validation.go:190-211`.
- Registration: `backend/internal/domain/project.go:12-17`.
- Invalid account case: `backend/internal/domain/evaluation_account_balance_test.go:160-187`.

Test valid and invalid configurations for every registered kind, including disabled evaluations. Assert the existing `evaluation.config.invalid` code, issue locations/order, and missing-account checks. These error paths are the main regression risk.
