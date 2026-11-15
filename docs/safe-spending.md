# Safe card spending evidence

Safe card spending answers two different questions. The card allowance estimates
how much additional card spending the selected future paycheck can support.
Cash after outstanding bills estimates what remains of the selected cash
accounts after their outstanding obligations through the end of the month.
Future income is excluded from the cash figure. Neither figure is a promise
about the bank's eventual month-end balance.

## Calculation ownership

The backend owns the cash summary and its supporting obligation rows. The
frontend renders those facts rather than independently summing a second set of
transactions. The summary and other model reads carry a revision so consumers
can avoid combining different model versions.

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
second time. An aggregate available-versus-posted difference does not establish
which individual payments are covered. Missing or ambiguous evidence must be
reported rather than hidden behind a precise, apparently certain amount.

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
