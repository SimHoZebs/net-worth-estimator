# Safe card spending evidence

Safe spending answers how much can safely be spent and which recorded spending
exceeds that amount. Cash after outstanding bills is the available cash in the
selected window less outstanding obligations in that window. The chart, remaining
allowance, daily allowance, and transaction cutoff use that same cash-backed
budget. Future paychecks do not increase money available to spend today.

## Calculation ownership

The backend owns the cash summary and its supporting obligation rows. The
frontend renders those facts rather than independently summing a second set of
transactions. The summary and other model reads carry a revision so consumers
can avoid combining different model versions.

One selected-cycle derivation owns the spending ledger, budget, chart, and
transaction crossing identities. Its budget reconciles recorded selected-window
spending with the server's selected-window cash remainder. The current range
uses cash observed through now; a past cycle uses cash observed through its
closing date. Both deduct only unpaid bills in the selected cycle. Past cycles deliberately
reconstruct the same budget rows as the current cycle from close cash evidence:
spend by selected end, per day, and pace limits with thresholds whenever
computable. Future windows with no evidence render the unavailable allowance
state. The protected
reserve reduces safe spending without changing the underlying cash remainder.
One effective-selection resolver owns card, cash-account, and bill ids: stored
`null` means all known ids, unknown ids drop out, and toggles normalize through
that same resolver so checkboxes and calculations cannot disagree.
An unavailable cash remainder disables dependent limits and cutoffs; it never
falls back to a future paycheck. Cutoffs identify the exact transaction, retain
that identity in either sort order, and do not turn a daily chart total into a
transaction boundary.
The cutoff replaces that transaction's existing row divider, with its label
centered in the line. It does not insert another table row or a second border.

Pending charges and pending refunds both count in recorded spending, counted
once on their transaction date. Pending status never excludes a row from the
ledger; only voided, disabled, or future-dated rows are left out. Bills are the
selected recurring transactions whose source is a selected cash account and
whose occurrence falls inside the visible cycle. The server returns a single
chronological bill ledger for the inclusive statement cycle. Each occurrence
carries its due date, amount when known, and payment status. **Paid** means a
posted movement explicitly claims that occurrence. It stays in the ledger but
is omitted from Upcoming bills because it is already accounted for in cash. **Unpaid** contributes to
the unpaid total. **Pending** identifies an unsettled payment and **Payment
unknown** identifies insufficient evidence. Uncertain coverage never becomes
a second deduction or a precise cash remainder. The chart groups priced bills
from this same ledger by date and projects increases from unpaid bills only.

## Monthly income threshold

The income threshold compares recorded spending with the expected pay from the
selected recurring income sources for the same UTC calendar month. Each
selected source contributes its scheduled occurrences in that month, so an
end-of-month paycheck counts for the month even when it falls outside the
statement cycle. Categories, names, amounts, and near dates never establish
that link, and transfers between the user's accounts never count. Income scope
is the shared cash scope: there is no separate income-account selection.
No selected sources makes the income threshold unavailable, without changing
known cash. Selected sources with no occurrence this month produce known zero
income. An expected amount that cannot be resolved makes income unavailable.
Eligible spending with an unresolved amount does the same.

The income threshold is a separate warning, not a cash deduction or a replacement
for the cash-backed limit. Savings can leave cash available while spending exceeds
this month's pay. Conversely, having expected pay does not prove cash remains.

The chart plots the expected monthly pay directly as the income line, with no
cycle offset math. Exact crossing identities come from the same recorded ledger
as the monthly totals. An income limit crossed before the visible cycle is
already exceeded at its start, not caused by its first displayed transaction.
Missing income evidence does not disable known cash evidence, and missing cash
evidence does not invent income. No text sits between the graph and its legend;
the line, the legend entry, and the exact in-row divider carry the threshold.

Use short labels with enough context to distinguish cash, reserve, monthly income,
and actual versus projected values. Preserve dates, financial qualifiers, action
meaning, and accessible names while removing filler and repeated explanations.

The summary accepts an explicit inclusive `start` and `end` calendar date.
The selected statement cycle determines the ledger range. `cashAsOf` identifies
the independent evidence cut: today for the current cycle and the closing date
for a past cycle. The unpaid total and cash after bills refer to the same cycle.
Upcoming cycles fetch the same ledger for their dates. They show scheduled
bills and chart markers while future cash and allowance remain unavailable.

Each selected cash account has its own observation boundary. A newer retirement
or investment observation cannot advance checking's boundary. Available cash,
when reported at that observation, is distinct from posted balance. When the
bank reports no available figure, the summary starts from the posted balance
and records basis posted. Both bases include confirmed movements after the
observation through the cash cutoff. A posted bill payment reduces cash once
through that movement; its paid occurrence adds no further deduction. Transfers between selected cash accounts
do not create spending or income for the combined accounts.

An obligation falling due today remains outstanding until there is evidence
that it was paid. A schedule occurrence and a projected realized payment are
modeling evidence, not bank settlement evidence. Explicit occurrence claims
identify the payment replacing a scheduled obligation. Equal amounts or similar
merchant names alone do not establish that identity.

The range does not invent an arrears ledger for dates before its start.
Current schedule estimates returned for an old range are still conditional
estimates; they are never evidence of historical payments. Selected-window
budgets come from close cash evidence, not from those schedule estimates.

Pending payments need particular care because available balance can already
include their holds. The cash calculation must not deduct a covered payment a
second time. A pending row predating the bank observation does not invalidate
the bank's reported available balance. An aggregate available-versus-posted
difference does not establish which individual payments are covered. Missing or
ambiguous evidence must be reported rather than hidden behind a precise,
apparently certain amount.

Keep the panel concise, without an inline diagnostic Details section or
explanatory allowance and paycheck captions. Bills remain visible in their
existing section. Show known balances even when a dependent estimate is
unavailable. Every offset shows the same main-card sections (spend by selected
end, per day, cash evidence with the selected window's Bills list, pace chart
with cash-limit labeling and the income threshold whenever computable) and the
same side-panel shape (titled "Spending this cycle"); the cash-payments total
lives only in that Transactions side panel, never inline on the main card, and
there is no closed-balance row.
The Upcoming bills heading shows the server’s unpaid total, followed by a list
of bills with muted due dates and individual row dividers. Ordinary unpaid bills
show just the due date. Only pending or unknown payments add a status beside it.

Bill dates are calendar dates under the existing UTC calendar convention.
Observation timestamps are instants. Changing the overall projection start or
introducing a different calendar is outside this correction.

## Historical views

The safe card is one definition parameterized by the selected statement cycle.
Arrow buttons move the visible cycle to earlier or later statement cycles
without bounds; every offset lists the same sections and rows on the main card
and the same side-panel shape. Past cycles reconstruct the same budget rows as
the current cycle from close cash evidence. Recorded card
activity is evidence of charges, independent of statement debt.
Purchases establish spending activity; they do not establish the closed
statement balance. Card settlements affect cash, while purchases affect card
spending. The same purchase must not be subtracted from cash again.

A historical cash balance requires observations at or before the historical
cut and applicable subsequent recorded movements. A missing available figure
alone uses the posted balance plus those movements. Missing coverage
for a selected account makes the aggregate unavailable. Today's balance is never a
substitute for a missing historical balance. Missing evidence is shown
explicitly with the same unavailable allowance and cash-figure states used for
the current window, while available recorded activity remains visible.

## Verification

Regression fixtures must be synthetic. Private production exports are
diagnostic inputs, never committed fixtures. Checks cover independent account
observation boundaries, due-today obligations, paid and pending claims,
pending-to-posted conversion, internal transfers, missing historical coverage,
and agreement between summary totals and their supporting rows.
