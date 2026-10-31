# Documentation: name evaluations and tables without totals

Status: approved (ready to schedule).

## Goal

Evaluation lists state totals that drift from the registry: the glossary fixes five tables and the technical overview claims six definitions, while the registry holds the full current set including planned purchases and what-if. The storage summary has the same drift shape: it enumerates tables but omits the bank-credential, Analysis, and group tables the schema creates.

Name entries without stating how many. Totals are the part that rots; the names are the contract.

## Scope

- Glossary keeps owning names; overview keeps owning runtime behavior. Both list the evaluation names with no count. Add the missing planned-purchases row already described in `docs/purchase-queue.md:46-60`.
- Storage summary lists the current tables with no completeness total. Add the missing bank-credential, Analysis, and group rows with the purpose column already in use there.
- Keep the machine-checked contracts and heading anchors intact; update inbound links if a heading moves.

## Acceptance criteria

- Prose searches for table/definition counts return no totals; the name lists match the registry order in `backend/internal/types/model.go:25-33`.
- `grep -c CREATE TABLE backend/internal/store/adapters/sqlite/schema.go` row coverage matches the summary rows for that file, plus the two Analysis schema files.
- `go -C backend test ./internal/domain -run TestEvaluationRegistryValidatesKnownDefinitions` and `./internal/store` conformance pass.
