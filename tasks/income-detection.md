# Backlog: income detection from bank deposits

Status: planned. Payroll is modeled as decomposed rules (gross, 401k,
match, tax) with generic resolvers; no income pipeline remains. This tracks
rebuilding income _detection_ on top of that.

## Next slice: detect candidate paycheck deposits

Goal: flag which bank postings look like income, without touching payroll
modeling.

Agreed scope: gross deposits only. The 401k/match/tax split events are out
of scope — detection must not need them.

Design (agreed):

- Candidates are sourceless external inflows landing in spendable (bank)
  accounts. Splits exclude themselves by shape: 401k/tax carry a source
  account, match lands in 401k rather than a bank account.
- Input is `transactionEvents` (works for rule occurrences, recorded actuals,
  and future bank-sync imports alike); no chain knowledge required.
- Group by cadence, annualize the estimate. Deposit record, cadence
  pattern, annualized figure, provenance stay distinct (see TERMS.md §F).

Acceptance:

- Domain function + unit tests over synthetic transaction events: monthly
  gross detected, 401k transfer / tax outflow / match ignored, one-time
  transfer between own accounts ignored.
- No API, store, or UI changes. No new types beyond the detection result.

Non-goals: UI surface, bank-sync import, withholding/tax logic, TERMS.md
wording changes.

## Later (owner decisions)

- TERMS.md §F "Income evidence" still describes the deleted server-table
  panel ("rendered under Data and sources"). Decide: rewrite around the
  detector output or drop the section.
