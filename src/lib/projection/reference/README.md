# reference/ — frozen Go-parity simulation kernel

Deterministic and Monte Carlo computation runs in the Go backend
(`backend/internal/domain/`); the browser never simulates. This directory
holds the TypeScript parity reference: the exact kernel the Go port was
derived from, kept so Vitest golden/parity suites and hook-test fixtures can
execute projections without a server.

Rules for this directory:

- Frozen: do not add features here. Fix semantics in the Go backend first,
  then mirror here only to preserve parity-test coverage.
- No production imports. UI, hooks, validation, and the engine client must
  import from `evaluation/` (config/validation only), `simulation/`
  (amount authoring only), `types/`, or `utils/`. The barrel (`index.ts`)
  re-exports reference symbols for tests; grep for `@/lib/projection`
  imports outside tests before adding new ones.
- Validation entry is `evaluation/configValidation.ts`, not the registry.
  `reference/evaluation/registry.ts` exists only for the reference
  orchestration path (`reference/analysis/*`).
