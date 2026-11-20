# Safe Spending

Safe Spending shows how much additional spending the plan can support, which
payments it still needs to cover, and what spending less now would leave for
the next cycle. The backend calculates the amounts from one evidence cut. The
Outlook card displays them without treating a checking balance as an allowance.

## Three dates

- The **spending reset** is a monthly display boundary, defaulting to the 20th.
  It does not clear liabilities or put new cash in the bank.
- **Payday** is a cash-flow checkpoint. The configured payday, defaulting to
  the 30th, sets when selected cards are paid. Scheduled income still arrives
  on its own dates; moving the card payoff does not move a paycheck.
- A card's **statement close** assigns charges to that card's own statement.
A statement is assigned to the next applicable payoff after closing.

Monthly days that do not exist in a given month fall on its last day. Dates in
the ledger use UTC.

Existing saved settings need the [offline migration](../deploy/MIGRATIONS.md)
before the updated API reads them. The migration fills missing settings
without replacing authored values.

## One obligation, one payment

A schedule occurrence is paid only when a posted transaction claims that exact
occurrence by the evidence cut. A claimed payment uses the actual posted amount
and does not deduct a second payment from cash. A pending authorization is not
proof of payment. A confirmed balance hold offsets only the part of the bill
it covers, and a pending claim on a different payment route does not clear the
bill from the forecast.

The payment bar covers the current payment period, from the day after the previous
configured payoff through the displayed payoff date. An overdue occurrence due in
that window still needs coverage and stays reserved. An occurrence from an
earlier period is outside the forecast: a missing link is not proof that it was
paid, and it does not turn the bill into an unpaid obligation either. Observation
history alone never rolls such a bill back into the ledger. An exact posted
settlement that happens inside the current window is the exception. It keeps its
own earlier occurrence in the ledger as paid so the payment bar does not show a
payment it already knows about as outstanding. It does not settle a different
occurrence.

An unlinked hold that matches an outstanding bill's route, amount, and date
window is flagged as a possible overlap. It does not change the forecast or
payment status without reconciliation.

The payment bar measures obligations through the displayed payoff date. It
includes card payoffs, not merchant charges billed to cards. An estimated charge
contributes to its statement instead. A posted card repayment reduces that
statement's unpaid amount; the bank movement is not a second expense.

Cash observations and confirmed movements are bounded by the evidence cut.
Do not subtract a posted payment again when the starting observation has
already captured it. Where a hold or a balance cannot establish what has been
covered, leave the dependent value unknown and show the independently known
amounts.

The default evidence cut is now. The summary API also accepts a historical
`asOf` date or timestamp for replay. Replays use the current plan and settings
but cannot use later checkpoints or posted activity as historical evidence.

## Spending room and next cycle

**Without cash cushion** is the paycheck funding this cycle, less the card
spending and expected recurring payments assigned to it. It can be negative.
**With cash cushion** adds existing cash after payments due before that
paycheck. **After savings goal** deducts the savings target from the
income-funded amount, not from existing cash. The projected extra cash saved
is a change to the cash cushion, not to net worth.

The cycle amounts include future income and are not all available as cash
today. The separate timing check walks dated payments in order; cash due
before an inflow cannot be funded by that inflow. The optional reserve is a
separate check, not a deduction from the three cycle amounts.

**Next cycle spending** separates new income-funded room from the cash carried
forward if no additional spending occurs. A future obligation belongs to one
funding period: a bill after payday and before the next paycheck is funded by
the earlier paycheck. The forecast can look beyond reset and cycle-end dates
to account for the paychecks and obligations that fund the allowance. The
carryover and the corresponding capacity from the current cycle are the same
money. A new purchase consumes that cash once, even if the card pays later.

The payment and next-cycle bars have different denominators. The former shows
paid versus outstanding obligations; the latter shows two sources of the same
projected allowance. Unknown components or shortfalls are shown as text, not
as misleading segments.

Card payments reduce the oldest outstanding statements first. A planned early
payment funded by carried cash uses that cash once; an early payment funded by
a later paycheck does not free up the current cushion for spending today.
A priced pending card purchase is included in the forecast as if it will post.
It is not a posted charge or a scheduled estimate, and the posted purchase
replaces it rather than adding a second expense. An unpriced authorization
affects its own estimate without invalidating a supported closed statement.
A cash shortfall already established before an unknown future payment still
proves there is nothing safe to spend today.

## November 17 example

With $392 cash and $91.08 still due before payday, the existing cash available
for immediate spending is $300.92. A $7,449.65 paycheck less $2,890.56 of card
payoffs and $3,963.57 of other assigned bills adds $595.52, or $95.52 after a
$500 savings target. The $896.44 combined room is not all available as cash
before payday.

If the next relevant paycheck is also $7,449.65 and funds a *different*
$3,963.57 set of bills, it adds $3,486.08. With no additional spending, the
$896.44 carries forward once, for $4,382.52 of projected capacity. These are
conditional figures, not a substitute for checking the dated payments.
