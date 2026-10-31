# Terminology

One name per concept. This file is normative: when another document or a string in the interface disagrees, this file wins. `PRODUCT_INTENT.md` §4 defines the concepts; the names live only here.

Use these names in product copy and documentation. Code and API contracts use `FinancialModel` for the complete financial model and `model` for its value. The engine uses `posting`, `recurrence-rule`, and `checkpoint` for stored financial rows.

## A. Transaction

A planned or recorded transfer of money into, out of, or between accounts.

Use **transaction**, qualified as **planned** or **recorded**. The saved model's "Transactions" tab holds the rules and dated entries you edit. An account's activity view holds the rows the engine computed from those rules.

- A recurring rule is **scheduled**; a dated single entry is **one-time**.
- A record supplied by a source is a **deposit** or **withdrawal**.

## B. Balance check

A recorded account balance that corrects modeled history for that account.
A check carries its exact observation time. Several checks per account per
day survive; the replay orders them by instant, executes same-time
postings first on a tie, and lets an owner check win only at its own
instant.

Use **balance check**. Its date column is **balance**; its tab is "Balance checks".

- Only an owner-disabled row shows **Excluded from account**. A
  pending or void bank row is recorded bank evidence. Settled bank rows
  participate like manual actuals once imported. Enabled alone decides
  execution: sync translation stores pending and void rows disabled, so
  they never move balances until settlement converts them enabled.
- A bank hold that vanished without posting shows **Did not post**; a live
  hold shows **Pending**.

## C. Projection, base case and range

Two computations over the same saved model. The **base case** is the single calculated path. The **range** is a percentile band across sampled scenarios.

- **Scenario** names one sampled assumption set, as in "80% of 400 scenarios".
- **What-if** names a simulator evaluation that layers hypothetical additions, disables, and modified copies on saved state without changing it. It is distinct from a sampled scenario. Promote replays it as sequential saves. Discard deletes the evaluation.

## D. Changes

Base edits save immediately and re-project.

Use **changes** only for a what-if evaluation that is not yet promoted. **Promote** replays it as sequential saves. **Discard** deletes the evaluation.

- The saved result in a comparison is the **saved model**.

## E. Evaluation

A named question asked of a projection, with a stored configuration and a result.

Use **evaluation**. The three roles below are distinct and stay distinct:

- **verdict** — the summary block on the outlook
- **constraint** — the binding limit that stopped a transaction
- **shortfall** — the gap between what a transaction requested and what funded it

Use **Funding gaps** for the default transaction-funding evaluation and its outlook summary. Use **Funding gap** for one inspector item and **No projected funding gaps** for a clear result. Keep custom evaluation names. `postingFulfillment` remains the engine's storage and API identifier; the stored default name "Posting fulfillment" displays as "Funding gaps" without a data rewrite.

`EvaluationTypeOrder` in `backend/internal/types/model.go` fixes the display order of the five evaluation tables: financial independence, net-worth threshold, account balance, posting fulfillment, cycle fulfillment. `EvaluationRegistry` in `backend/internal/domain/evaluation_runtime.go` owns the registered definitions; the cycle fulfillment definition lands with its runtime.

## F. Income evidence

**Analysis** is a versioned inference over saved evidence. It produces findings
with reasons and uncertainty. Analysis runs independently of account sync and
does not change the saved financial model. BNPL detection is an Analysis. Income
evidence is the result of income-pattern Analysis, which remains planned.

An inference from recorded one-time external inflows, such as an annualized estimate of net pay. It never changes planned income and does not establish bank provenance.

Use **income evidence**. Its parts stay distinct: **deposit** (the record), **cadence** (the observed pattern), **estimate** (the annualized figure), **provenance** (where it came from).

## G. Financial model and user scope

The **financial model** is the collection of accounts, transactions, balance checks, rules, payment terms, planned purchases, and evaluations. The **saved model** is its saved state, used for calculation and import/export.

The **user** owns those rows. **Account** means a financial account.

A **guest** is a provisioned user with limited assigned permissions. Guest access uses the same user resource and data tables as other users.

Base forms save row changes directly. Failed submissions retain their fields in the form for retry.

## Evaluation and income evidence are different things

**Evaluation** asks a question of a projection. It is configured on the saved model and rendered on the outlook.

**Income evidence** computes from recorded deposits. Its detector remains planned.

Both produce a result from their own inputs.

## Verbs

| Action                   | Use                                   |
| ------------------------ | ------------------------------------- |
| compute the single path  | project (code, docs), calculate (copy) |
| compute the sampled band | calculate (copy)                      |
| send edits to the server | save (base rows), promote (what-if)    |
| throw away a what-if     | discard                               |
| read the model           | load (copy), read (code)               |
| import CSV into SQLite   | import                                |
| sync a bank              | sync                                  |
| report model problems    | validate (code), fix (copy)            |

## Keeping the names

The interface is the surface these names appear on, so the check is visual. `frontend/tests/workspace.spec.ts` exercises every route and checks the displayed names.
