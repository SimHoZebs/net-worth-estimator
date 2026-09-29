# Terminology

One name per concept. This file is normative: when another document disagrees, this file wins. It defines the words the product uses and nothing else — no file paths, no symbol names, no test files. A reader who finds a term here should be able to use it without knowing how anything is built.

## A. Transaction

A planned or recorded movement of money into, out of, or between accounts.

Use **transaction**, qualified as **scheduled** or **one-time**. "Activity" names the screen that groups the transaction views; it is a grouping, not a transaction.

- Retired from the interface: posting, movement, money movement.
- Retired from prose: posting, one-time movement, planned movement, projected transaction.

## B. Balance check

A recorded end-of-day account balance that corrects modeled history for that account.

Use **balance check**. Its date column is **balance**. "Reconcile" is a verb the user performs; "Balance checks" is the screen.

- Retired from the interface: checkpoint, balance checkpoint, observed balance.
- Retired from prose: balance checkpoints, reconciliation.

## C. Projection and range

Two computations over the same plan. **Base projection** is the single calculated path. **Range** is a percentile band across sampled runs.

- Retired from the interface: deterministic, Monte Carlo, stochastic, simulation, baseline projection.
- "Scenario" names one sampled assumption set, as in "80% of scenarios fall in this range". It is never the name of the result.
- Technical writing about the engine may name its own computation modes. This retirement applies to what the product says, not to how a computation is described internally.

## D. Changes

The edits in the current session that are not yet saved.

Use **changes**, with **unsaved** as the state adjective. **Save** sends them onward; **discard** throws them away. Neither is spelled with another verb.

- Retired from the interface: draft, temporary, temporary version, current changes.
- Retired from prose: temporary version, temporary change, staged draft, editing baseline.
- "Baseline" labels the saved result in a comparison, not the edits.

## E. Evaluation

A named question asked of the projection, with a stored configuration and a result.

Use **evaluation**. Instance labels stay plain: "Financial independence", "Net worth threshold", "Planned transaction completion".

- Retired from prose: goal check, evaluation blocker.
- Three roles are distinct and stay distinct:
  - **verdict** — the summary of the whole result
  - **constraint** — the binding limit that stopped a transaction
  - **shortfall** — the outcome of the planned-transaction-completion evaluation

## F. Analysis

A named computation over recorded deposits that never changes the plan. Three run in order: classification, payroll pattern, net pay.

Use **analysis**, and name each output for what it answers, as in "Net pay".

- Retired from the interface: posting-derived, observation, salary estimate, FI.
- Retired from prose: evidence analysis, posting-derived, posting observation.
- Sub-terms that stay distinct: **deposit** (the record), **payroll pattern** (detection), **net pay** (the estimate), **evidence** (provenance).
- A payment rail is shown as "Payment method".

## Evaluation and analysis are different things

**Evaluation** asks a question of a projection. It is configured in Settings and shown on Results.

**Analysis** computes from recorded deposits. It is configured nowhere and shown on Analysis.

Both produce a result. Neither reads or writes the other's inputs.

## Verbs

| Action | Use | Do not use |
| --- | --- | --- |
| compute the single path | project, calculate | simulate, run, execute |
| compute the sampled band | calculate | sample, Monte Carlo |
| send edits onward | save | persist, commit, apply, write |
| throw away unsaved edits | discard | revert, clear, reset |
| fetch the model | load, read | fetch, pull, retrieve |
| import source files | import | ingest, ingestion |
| sync a bank | sync | — |
| report model problems | validate, fix | diagnose, check |
