---
id: 060
title: Give each API payload one type definition
scope: contracts-types
status: needs-review
---

Server payloads are declared twice. `contracts.ts` hand-writes roughly fifty interfaces while the generated model tree declares the same shapes from the OpenAPI snapshot. The two disagree — generated `FinancialModel` uses `Account[] | null` where the hand-written one uses non-null `BackendAccount[]` — so endpoint calls cross the gap with `as never` or `as unknown as` and lose checking at five write sites. The `/v1/flows` mirror is the same problem in one place: its header claims VIS-01 has not landed and that generation cannot emit the types, but the snapshot and generated client now provide `FlowGraph`, `FlowsOutputBody`, and `buildFlowGraph`. The generated tree is rebuilt at container start, so the durable risk is a snapshot change desyncing the hand-written set without a compile error.

Make the generated model the source of truth. Reduce `contracts.ts` to aliases or re-exports over `./generated/model/...` plus genuinely client-owned values, remove the `as never` bridges with typed adapters where normalization is real, and delete the hand-written flow contract, envelope, key guard, and wrapper in favour of generated `buildFlowGraph`. Keep client-owned flow constants, `flowNodeById`, `flowNodeName`, narrow `FlowKind`/`FlowMovement` aliases, and a guard for the generated nullable arrays and string kind fields.

Verify by regenerating the client and typechecking with the casts removed, then add a parity test over key sets and a round-trip test for `cycleStartDay`, `paydayDay`, and `savingsTarget`. The Flows page must still render the Sankey, filter, table, and edge panel, and a malformed graph must still surface a user-facing error.

References: `frontend/src/api/contracts.ts:38-621`; `frontend/src/api/generated/model/financialModel.ts:15-30`; `frontend/src/api/flows.ts:8-16,28-179`; `frontend/src/api/generated/endpoints.ts:2009-2038`; `frontend/src/state/useFlowGraph.ts:3-4,96-106`; `as never` at `frontend/src/api/serverModelImport.ts:49`, `frontend/src/state/workspaceWrites.ts:252`, `frontend/src/state/useRemoteProjection.ts:146`, `frontend/src/state/useSafeSpendingSettings.ts:173`.
