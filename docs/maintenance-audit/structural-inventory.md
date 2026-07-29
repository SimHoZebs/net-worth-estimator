# Structural Inventory

## Repository Shape

- Source files under `src/`: 165
- TS/TSX lines, including tests: 23,073
- Test files under `src/`: 25
- Additional plugin test files: 1
- Empty directories under `src/`: none
- Tracked screenshots, logs, viewport dumps, debug files, and image artifacts: none found
- Ignored generated trees present locally: `dist/`, `node_modules/`, and `.husky/_/`

## Placement Assessment

- React components are generally under `src/components/`.
- Projection domain code is grouped under `src/lib/projection/` by analysis, behavior, evaluation, model, simulation, source, type, and utility concerns.
- Worker wire contracts are correctly centralized in `src/workers/types.ts`, near worker producers and consumers.
- Compatibility scenario barrels are locally unreferenced but deliberately retained under the documented compatibility window.
- Tests use a mix of colocated and `__tests__` conventions. This is inconsistent but not currently causing ownership ambiguity severe enough to justify a broad move.

## Artifact Assessment

No generated or debugging artifacts are tracked. The ignored `dist/` directory contains stale scenario-era output, so future release verification should regenerate it deliberately rather than treating the local directory as current.

## Type Assertion Concentration

- Production `as never`: 24, all in active read-only table definitions
- Production `as any`: 4, all in an unused stacked chart implementation
- Production `as unknown`: 10, mostly registry, JSON, and domain adapter boundaries
- Explicit production `any` annotations were not found
