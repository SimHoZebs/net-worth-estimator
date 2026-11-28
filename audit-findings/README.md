# Audit findings

Finding IDs are stable and are never reused. This index includes the current decision backlog and records retained from the latest audit.

## Status legend

- `needs-review` — proposed and awaiting a decision.
- `accepted` — approved but not yet applied.
- `rejected` — the user chose to keep the current behavior.
- `deferred` — the decision or work was postponed.
- `implemented` — the change landed and its verification is recorded.
- `superseded` — a newer finding replaced this record.

## Current finding index

| ID | Title | Scope | Status |
| --- | --- | --- | --- |
| [082](082-projection-engine-version.md) | Remove the single-value projection engine version check | backend-domain | superseded |

## Retired aliases

| Use in findings | Source names grouped under it |
| --- | --- |
| Balance check | Checkpoint, bank observation |
| Range | Stochastic bands, Monte Carlo statistics |
| Recorded history | Actual-only history |
| Transfer information | Transfer peer, transfer-link membership |
| Confirmation dialog | Alert dialog |
| Identity service | Better Auth image, auth image |
| Scenario count | Trial count, run count |
| Saved range | Durable stochastic cache, canonical stochastic artifacts |
| Schedule recurrence | Legacy schedule frequency |
| Numeric amount | Amount literal, decimal expression |

## Audit history

- Optimization audit — 2026-11-27 at `db35e305`.
- Optimization audit — 2026-11-21 at `7ac73105`.
- Pattern detection audit — 2026-11-18.
- shadcn Base UI migration audits — 2026-11-14.

Implemented and rejected records from these audits are pruned; superseded decisions remain in the index.
