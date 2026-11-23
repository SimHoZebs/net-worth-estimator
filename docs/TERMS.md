# Terminology

One name per concept. This file is normative: when another document or a string in the interface disagrees, this file wins. `PRODUCT_INTENT.md` §4 defines the concepts; the names live only here.

Use these names in product copy and documentation. Code and API contracts use `FinancialModel` for the complete financial model and `model` for its value. The engine stores **transactions** and **schedules**; the physical tables keep their established storage names.

## A. Transaction

A recorded movement of money into, out of, or between accounts.

Use **transaction** for a recorded movement. The saved model's "Transactions" tab holds schedules and transactions you edit. An account's activity view holds the entries the engine computed from those records.

- A standing instruction is a **schedule**; a dated single movement is **one-time**.
- A record supplied by a source is a **deposit** or **withdrawal**.
- A transaction recorded as an occurrence of a schedule fulfills the occurrence the schedule guessed; the occurrence happened when the transaction happened.
- The link is a **claim**: the transaction claims that occurrence. A schedule never points at a transaction. A claim names the guessed occurrence date, never the transaction's own day; recorded rows display and sort by their own day.
- Starting a schedule from a transaction creates a separate schedule and claims the transaction's date as its first occurrence. The transaction stays recorded and unchanged.
- Ending a schedule with a transaction records the one-time movement that happened and removes the schedule.

## B. Balance check

A recorded account balance that corrects modeled history for that account.
A check carries its exact observation time.

Use **balance check**. Its date column is **balance**; its tab is "Balance checks".
Recorded-history application order is owned in
[Applying Recorded History and Checkpoints](../TECHNICAL_OVERVIEW.md#7-applying-recorded-history-and-checkpoints).

- Only an owner-disabled row shows **Excluded from account**. A
  pending or void bank row is recorded bank evidence. Settled bank rows
  participate like manual actuals once imported. Enabled alone decides
  execution: sync translation stores pending and void rows disabled, so
  they never move balances until settlement converts them enabled.
- A bank hold that vanished without a posted charge shows **Did not post**; a live
  hold shows **Pending**.

## C. Projection and range

Two computations over the same saved model. The **projection** is the single calculated path. The **range** is a percentile band across sampled scenarios.

- **Scenario** names one sampled assumption set, as in "80% of 400 scenarios".
- **What-if** names a simulator evaluation that branches from the projection to test hypothetical additions, disables, and modified copies without changing saved state. It is distinct from a sampled scenario. Promote applies it as sequential saves. Discard deletes the evaluation.

## D. Changes

Base edits save immediately and invalidate affected calculations. Components request a new projection only when they need its result.

Use **changes** only for a what-if evaluation that is not yet promoted. **Promote** applies it as sequential saves. **Discard** deletes the evaluation.

- The saved result in a comparison is the **saved model**.

## E. Evaluation

A named question asked of a projection, with a stored configuration and a result.

Use **evaluation**. The three roles below are distinct and stay distinct:

- **verdict** — the summary block on the outlook
- **constraint** — the binding limit that stopped a transaction
- **shortfall** — the gap between what a transaction requested and what funded it

Use **Funding gaps** for the default transaction-funding evaluation and its outlook summary. Use **Funding gap** for one inspector item and **No projected funding gaps** for a clear result. Keep custom evaluation names. `transactionFulfillment` remains the engine's storage and API identifier; the stored default name "Transaction fulfillment" displays as "Funding gaps" without a data rewrite.

`EvaluationTypeOrder` in `backend/internal/types/model.go` fixes the display order of the evaluation tables: financial independence, net-worth threshold, account balance, transaction fulfillment, cycle fulfillment, planned purchases, what-if. `EvaluationRegistry` in `backend/internal/domain/evaluation_runtime.go` owns the registered definitions; cycle fulfillment is shipped (`cycleFulfillmentDefinition` in `backend/internal/domain/evaluation_cycle.go`).

## F. Income evidence

**Analysis** is a versioned inference over saved evidence. It produces findings
with reasons and uncertainty. Analysis runs independently of account sync and
does not change the saved financial model. BNPL detection is an Analysis. Income
evidence is the result of `payments` Analysis.

An inference from recorded recurring external inflows, such as an annualized estimate of net pay. The highest annualized candidate is the main consistent inflow when currencies are comparable, ranked without asking the user to state it. It never changes planned income and does not establish bank provenance. A replaceable judgment provider may refine the assessment; it may be automated or human-operated. Explicit feedback is audited independently of whether the provider learns from it. Hide and restore are never labels.

Use **income evidence**. Its parts stay distinct: **deposit** (the record), **cadence** (the observed pattern), **estimate** (the annualized figure), **provenance** (where it came from).

## G. Financial model and user scope

The **financial model** is the collection of accounts, transactions, balance checks, schedules, payment terms, planned purchases, and evaluations. The **saved model** is its saved state, used for calculation and import/export.

The **user** owns those records. **Account** means a financial account.

The financial model is the combined input for calculation and import/export. It does not make account maintenance or recorded activity part of the simulation lifecycle. Forecast outcomes and evidence Analysis each have their own lifecycle.

A **guest** is a provisioned user with limited assigned permissions. Guest access uses the same user resource and data tables as other users.

Base forms save changes directly. Failed submissions retain their fields in the form for retry.

## H. Credit card statements

A **credit card** is an account kind that contributes to debts, not available
cash. The account kind does not establish which purchases have been imported.

A **statement** is derived for each close in a card's history from its
**statement closing day** and recorded bank evidence. The latest bank balance
observed in that statement cycle, taken as debt, is the **statement balance**;
posted activity after that observation is applied from it. The open cycle is
an estimate until it closes. A close with no observation is unknown, never
zero and never a guess from a closing day or a current balance. Payment terms
supply the **due date**; a card without terms has no known due date.

A **card payment** is a movement to a credit card. When both sides are present,
the linked transfer is one payment. **Apply payment** records which statement a
posted card payment covers. The **remaining statement balance** is the billed
amount less payments applied to it. A statement is **paid in full** when that
amount reaches zero. A suggestion alone does not apply the payment.

## Verbs

| Action                   | Use                                   |
| ------------------------ | ------------------------------------- |
| compute the single path  | project (code, docs), calculate (copy) |
| compute the sampled band | calculate (copy)                      |
| send edits to the server | save (base rows), promote (what-if)    |
| throw away a what-if     | discard                               |
| read the model           | load (copy), read (code)               |
| load a model into SQLite | import |
| sync a bank              | sync                                  |
| report model problems    | validate (code), fix (copy)            |

## Keeping the names

The interface is the surface these names appear on. Regression coverage for
interface names follows [TESTING.md](../TESTING.md#integration-suite).
