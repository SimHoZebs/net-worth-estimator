# Evidence-Backed Transaction Classification

Status: backlog

## Goal

Replace the first-pass single transaction-type heuristic with an extensible classifier that emits independent, evidence-backed property claims.

## Scope

- Add typed orthogonal claims for direction, payment rail, purpose, counterparty identity, income subtype, and location.
- Preserve source-provided facts separately from rule, behavioral, external, and user-authored claims.
- Register lexical and source rules instead of adding conditions to a central classifier switch.
- Add behavioral claim producers for recurring income, bonuses, subscriptions, refunds, and transfers.
- Resolve conflicting claims by explicit source precedence and confidence while retaining evidence and alternatives.
- Keep payroll detection, spending maps, dining comparisons, and salary inference as downstream analyses consuming resolved claims.

## Acceptance Criteria

- Each claim identifies its property, value, confidence, producer, source, and evidence.
- A transaction can hold multiple simultaneous claims without one enum overwriting another.
- User corrections override derived claims without mutating the original transaction facts.
- Classifier rules are independently testable and adding a rule does not modify unrelated rules.
- Ambiguous or conflicting claims produce diagnostics instead of silently becoming facts.

## Non-goals

- No machine-learning provider or external enrichment service in the first implementation.
- No changes to projection simulation semantics or `FinancialModelDocument`.
- No gross-salary inference from net-pay claims alone.
