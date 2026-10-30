# Terminology

One name per concept. This file is normative: when another document or a string in the interface disagrees, this file wins. `PRODUCT_INTENT.md` §4 defines the concepts; the names live only here.

The names are display names. The engine keeps its own vocabulary: the Go API, the CSV seed files, and the SQLite tables still say `posting`, `recurrence-rule`, `checkpoint`, and `draft`. Those are storage and wire names, not words shown to a user.

## A. Transaction

A planned or recorded transaction of money into, out of, or between accounts.

Use **transaction**, qualified as **planned** or **recorded**. The saved model's "Transactions" tab holds the rules and dated entries you edit. An account's activity view holds the rows the engine computed from those rules.

- Retired from copy: posting.
- Retired from prose: projected transaction.
- A recurring rule is **scheduled**; a dated single entry is **one-time**.
- A record supplied by a source is a **deposit** or **withdrawal**, not a transaction.

## B. Balance check

A recorded end-of-day account balance that corrects modeled history for that account.

Use **balance check**. Its date column is **balance**; its tab is "Balance checks".

- Retired from copy: checkpoint, balance checkpoint, observed balance.
- Retired from prose: balance checkpoints, reconciliation.

## C. Projection, base case and range

Two computations over the same saved model. The **base case** is the single calculated path. The **range** is a percentile band across sampled scenarios.

- Retired from copy: deterministic, Monte Carlo, stochastic, simulation, baseline projection.
- Engine sections name the engine's own computation modes, so no prose term is retired there.
- **Scenario** names one sampled assumption set, as in "80% of 400 scenarios". It is never the name of the result.
- **What-if** names a simulator evaluation that layers hypothetical additions, disables, and modified copies on saved state without changing it. It is distinct from a sampled scenario. Promote replays it as sequential saves. Discard deletes the evaluation.

## D. Changes

Base edits save immediately and re-project. There are no unsaved base edits.

Use **changes** only for a what-if evaluation that is not yet promoted. **Promote** replays it as sequential saves. **Discard** deletes the evaluation.

- Retired from copy: draft, temporary, temporary version, temporary plan, current changes, unsaved changes for base edits.
- Retired from prose: temporary change, staged draft, editing baseline.
- The saved result in a comparison is the **saved model**.

## E. Evaluation

A named question asked of a projection, with a stored configuration and a result.

Use **evaluation**. The three roles below are distinct and stay distinct:

- **verdict** — the summary block on the outlook
- **constraint** — the binding limit that stopped a transaction
- **shortfall** — the gap between what a transaction requested and what funded it

Use **Funding gaps** for the default transaction-funding evaluation and its outlook summary. Use **Funding gap** for one inspector item and **No projected funding gaps** for a clear result. Keep custom evaluation names. `postingFulfillment` remains the engine's storage and API identifier; the stored default name "Posting fulfillment" displays as "Funding gaps" without a data rewrite.

`EvaluationTypeOrder` in `backend/internal/types/model.go` fixes the display order of the five evaluation tables: financial independence, net-worth threshold, account balance, posting fulfillment, cycle fulfillment. `EvaluationRegistry` in `backend/internal/domain/evaluation_runtime.go` owns the registered definitions; the cycle fulfillment definition lands with its runtime.

- Retired from prose: goal check, evaluation blocker.

## F. Income evidence

An inference from recorded one-time external inflows, such as an annualized estimate of net pay. It never changes planned income and does not establish bank provenance.

Use **income evidence**. Its parts stay distinct: **deposit** (the record), **cadence** (the observed pattern), **estimate** (the annualized figure), **provenance** (where it came from).

- Retired from copy: posting-derived, observation, salary estimate, FI.
- Retired from prose: evidence analysis, posting-derived net pay.

## Evaluation and income evidence are different things

**Evaluation** asks a question of a projection. It is configured on the saved model and rendered on the outlook.

**Income evidence** computes from recorded deposits. It is not configured and is rendered under Data and sources.

Both produce a result. Neither reads or writes the other's inputs.

## Verbs

| Action                   | Use                                    | Do not use                    |
| ------------------------ | -------------------------------------- | ----------------------------- |
| compute the single path  | project (code, docs), calculate (copy) | simulate, run, execute        |
| compute the sampled band | calculate (copy)                       | sample, Monte Carlo           |
| send edits to the server | save (base rows), promote (what-if)      | persist, commit, apply, write |
| throw away a what-if       | discard                                | revert, clear, reset          |
| fetch the model          | load (copy), read (code)               | fetch, pull, retrieve         |
| import CSV into SQLite   | import                                 | ingest, ingestion             |
| sync a bank              | sync                                   | —                             |
| report model problems    | validate (code), fix (copy)            | diagnose, check               |

## Keeping the names

The interface is the surface these names appear on, so the check is visual. `frontend/tests/workspace.spec.ts` exercises every route; when a name is retired, add a test asserting the new wording appears and the old one does not.
