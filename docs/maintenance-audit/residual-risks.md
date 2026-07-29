# Residual Risks

## Runtime Warnings

Node still emits experimental local-storage and module-registration warnings during the test run. Theme initialization now handles unavailable storage correctly, so these warnings do not fail tests, but dependency/runtime upgrades may change their behavior.

## Performance Measurement

The maintenance work removed known lifecycle churn and duplication but did not add broad browser profiling. Schedule generation, large-model rendering, and worker payload costs should be optimized only after representative measurement.

## Hook Similarity

Deterministic and stochastic hooks retain similar latest-request orchestration because their stale-result, progress, and configuration semantics differ. Extract a private shared primitive only if future changes demonstrate concrete drift; do not replace the specialized hooks with a flag-heavy public API.

## Data Scale

Editor subscriptions and render-time collection construction may become significant for unusually large financial models. Current correctness tests do not establish a production scale limit.

## Worktree Basis

The remediation was performed in an isolated worktree containing the staged model-input changes that existed on 2026-07-29. The verification record distinguishes the original committed audit from this integrated worktree result.
