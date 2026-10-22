# Financial Independence Branch Simulation

Status: backlog

## Goal

Stop re-expanding account rules and replaying monthly branches inside every scenario for the seeded `Financial independence` goal (`public/configs/behavior/financial-independence.csv:2`).

## Scope

- Keep the base projection per scenario unchanged.
- Inline the single-use generic loop in `backend/internal/domain/behavior.go` into `evaluateCycleWithShared` in `backend/internal/domain/evaluation_fi.go`.
- Hoist sample-independent `ResolveOccurrences` of branch rules out of the per-sample loop.
- Document the branch-vs-main simulation boundary.

## Acceptance Criteria

- Seeded `Financial independence` goal shows the same first self-sustaining date and success probability as before.
- Long-horizon range runs no longer stall in modeling-scenarios progress for the same input.
- `CGO_ENABLED=0 go vet ./backend/internal/domain/` passes.
- Deterministic and stochastic FI tests pass.

## Non-goals

- No change to candidate date enumeration or withdrawal policy.
- No change to panel copy or FI configuration shape.
- No changes to other evaluation kinds (net worth, account balance, fulfillment, cycle).
