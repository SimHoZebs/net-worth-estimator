# Structural Inventory

## Original Audit Snapshot

The 2026-07-25 audit recorded 165 source files, 23,073 TS/TSX lines including tests, 25 test files under `src/`, and one plugin test. It found no tracked generated or debugging artifacts.

## Remediated Worktree Snapshot

- Files under `src/`: 196
- TS/TSX lines, including tests: 29,017
- Test files under `src/`: 51
- Additional plugin test files: 1
- Production `as never` assertions: 0
- Production `as any` assertions: 0
- Production `as unknown` assertions: 8, concentrated at intentional parsing, registry, and domain-adapter boundaries

The increased file and line counts include the staged model-input feature work copied into the maintenance worktree and the maintenance regression tests. They are not directly comparable to the original committed audit snapshot.

## Placement Assessment

- React components remain grouped by feature under `src/components/`.
- Projection domain code remains under `src/lib/projection/`.
- Worker wire contracts remain next to worker producers and consumers in `src/workers/types.ts`.
- Projection orchestration now has a dedicated runtime owner while remaining mounted above routed pages.
- Generic table behavior and shortfall presentation adaptation have direct focused tests.

## Artifact Assessment

No generated or debugging artifacts are tracked. Production build output remains ignored and disposable.
