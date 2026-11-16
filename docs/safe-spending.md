# Safe card spending evidence

Safe spending answers how much can safely be spent and which recorded spending
exceeds that amount. Cash after outstanding bills is the current available cash
less outstanding obligations through the end of the month. The chart, remaining
allowance, daily allowance, and transaction cutoff use that same cash-backed
budget. Future paychecks do not increase money available to spend today.

## Calculation ownership

The backend owns the cash summary and its supporting obligation rows. The
frontend renders those facts rather than independently summing a second set of
transactions. The summary and other model reads carry a revision so consumers
can avoid combining different model versions.

One current-cycle derivation owns the spending ledger, budget, chart, and
transaction crossing identities. Its budget reconciles recorded cycle spending
with the server's current cash remainder. This is today's spending capacity
applied to the cycle, not a reconstructed historical bank balance. The protected
reserve reduces safe spending without changing the underlying cash remainder.
An unavailable cash remainder disables dependent limits and cutoffs; it never
falls back to a future paycheck. Cutoffs identify the exact transaction, retain
that identity in either sort order, and do not turn a daily chart total into a
transaction boundary.
The cutoff replaces that transaction's existing row divider, with its label
centered in the line. It does not insert another table row or a second border.

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
It always returns evidenced available cash at `start` and conditional
outstanding bills within that range. It has no current-versus-historical mode
and does not change its meaning based on the wall clock. The current view asks
for today through month-end. The closed view asks for the closing date alone
and uses only the cash evidence, not the conditional bill estimate.

Each selected cash account has its own observation boundary. A newer retirement
or investment observation cannot advance checking's boundary. Available cash,
when reported at that observation, is distinct from posted balance. Subsequent
confirmed movements are counted once. Transfers between selected cash accounts
do not create spending or income for the combined accounts.

An obligation falling due today remains outstanding until there is evidence
that it was paid. A schedule occurrence and a projected realized payment are
modeling evidence, not bank settlement evidence. Explicit occurrence claims
identify the payment replacing a scheduled obligation. Equal amounts or similar
merchant names alone do not establish that identity.

The range does not invent an arrears ledger for dates before its start.
Current schedule estimates returned for an old range are still conditional
estimates; they are never evidence of historical payments or budgets.

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
unavailable; omit unsupported historical metrics rather than filling the page
with blank rows. Last cycle shows totals only, with transactions in the drawer.
The bills section has one heading and total, followed by a visibly separate list
of bills with muted due dates and individual row dividers.

Bill dates are calendar dates under the existing UTC calendar convention.
Observation timestamps are instants. Changing the overall projection start or
introducing a different calendar is outside this correction.

## Historical views

Last cycle presents recorded card activity independently of statement debt.
Purchases establish spending activity; they do not establish the closed
statement balance. Card settlements affect cash, while purchases affect card
spending. The same purchase must not be subtracted from cash again.

A historical cash balance requires observations at or before the historical
cut and applicable subsequent recorded movements. Missing coverage for a
selected account makes the aggregate unavailable. Today's balance is never a
substitute for a missing historical balance.

Current schedules cannot recreate an old budget or the forecast that the user
saw at that time. Without saved budget evidence, the historical spending curve
has no budget or protected-reserve thresholds. Missing historical evidence is
shown explicitly, while available recorded activity remains visible.

## Verification

Regression fixtures must be synthetic. Private production exports are
diagnostic inputs, never committed fixtures. Checks cover independent account
observation boundaries, due-today obligations, paid and pending claims,
pending-to-posted conversion, internal transfers, missing historical coverage,
and agreement between summary totals and their supporting rows.
