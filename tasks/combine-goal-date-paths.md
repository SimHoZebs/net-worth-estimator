# Combine Goal-Date Paths

Status: backlog

## Goal

Share one reached-date implementation between the two seeded goals that answer the same question shape: when does the target first happen across scenarios.

Seeded rows:

- `Reach $1,000,000 net worth` (`public/configs/behavior/net-worth-threshold.csv:2`)
- `Emergency fund reaches $30,000` on `checking` (`public/configs/behavior/account-balance.csv:2`)

## Scope

- Keep the two different scans: total net worth vs one account balance.
- Create one shared reached-date maker (count scenarios reaching target, derive early/middle/late dates, decide met label).
- Delete the copied accumulator, finalize, and status blocks in `backend/internal/domain/evaluation_threshold.go` and `backend/internal/domain/evaluation_account_balance.go`.
- Point both goals at the shared maker.

## Acceptance Criteria

- Both seeded goals show the same first date, probability, and early/middle/late dates as before.
- New goals added through `Add evaluation` (`Household net worth`, `An account balance`) use the same path.
- `CGO_ENABLED=0 go vet ./backend/internal/domain/` passes.
- Deterministic and stochastic evaluation tests pass.

## Non-goals

- No change to scan logic (what counts as reaching the target).
- No change to panel copy or goal configuration shape.
- No changes to other evaluation kinds (financial independence, fulfillment, cycle).
