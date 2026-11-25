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
the spending cycle and payment window use UTC.

Existing saved settings need the [offline migration](../deploy/MIGRATIONS.md)
before the updated API reads them. The migration fills missing settings and
carries the retired reserve into the savings goal where the saved goal is
missing or zero. An authored nonzero goal is preserved. No settings are created
for a user without a saved document.

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

The payment bar and bill details cover non-card cash bills through the displayed
payoff date. Card payoffs and repayments owned by a single tracked card are
summarized separately by the server's `statementReserve`, not shown as cash bills
in the bar.
A missing statement estimate does not make the bar unknown. A split card transfer
that cannot be allocated to one tracked card stays in the bar and bill details so
its deduction is not lost. Card repayments remain forecast inputs even though
they are not displayed as bills. A posted repayment reduces that statement's
unpaid amount; the bank movement is not a second expense.

## Transactions drawer

The Safe Spending **Transactions** drawer is recorded activity for the active
spending cycle, from `cycleStart` through `cycleEnd`, capped at the full `cashAsOf`
UTC day. The cycle starts on the configured reset day and ends the day before the
next reset. The summary exposes `cashAsOf`, not an exact evidence instant, so later
same-day rows are included and next-day instants are excluded. Its caption shows
the full server-owned cycle. Once activity is ready, the card action and tab badge
show the same number of visible transaction rows. While activity is loading or
unavailable, the usable card action reads **Transactions this cycle** without
inventing a zero.

**Spending this cycle** combines non-transfer spending from selected tracked cards
and selected cash accounts. Refunds remain spending credits, income is omitted,
and pending rows are included. Void holds, deliberately disabled or excluded
rows, scheduled obligations, and rows outside the active cycle are omitted.
**Spent** and the per-card figures aggregate these same rows. A calculated amount
keeps the affected total unknown instead of turning it into zero. These figures
explain recorded activity only; they do not recreate the Safe Spending allowance
or its threshold crossings.

**Cash payments this cycle** lists outgoing recorded transfers from selected cash
accounts. Explicit account routing or a confirmed transfer link identifies a
transfer; names alone do not. Overlapping account selections and both legs of a
confirmed transfer are shown once, with the recorded transfer total and active
cycle dates in the section subtitle. Scheduled bills and card payoff estimates
stay in the main Bills and payments explanation rather than appearing as
pseudo-transactions or entering the transaction count.

Rows use the shared transaction indicators and open the shared transaction detail
sheet. Closing that detail returns to Transactions, and Escape closes one sheet
at a time.

## Reviewing card payments

Statements are derived from each card's closing day and bank evidence, so no
billed balance, close date, or due date is recorded by hand. In the payment
transaction, Suggestions can identify an open statement once the destination
card is known. An exact match to the remaining balance is strong evidence for
the suggestion, not proof or automatic confirmation. A smaller payment can
still be applied to the statement without marking it paid in full.

A missing statement does not turn a known card payment into a purchase. The
payment still reduces checking cash, and the card's purchases still account for
the spending. Identifying a payment and applying it to a statement are separate
decisions.

## Cash evidence

Cash observations and confirmed movements are bounded by the evidence cut.
Do not subtract a posted payment again when the starting observation has
already captured it. Where a hold or a balance cannot establish what has been
covered, leave the dependent value unknown and show the independently known
amounts.

The evidence cut is now. The summary uses the current plan and settings and
does not accept a recorded-history application parameter.

Each selected cash account uses its effective display basis at that
checkpoint. An explicit posted preference takes the applied posted figure. The
configured or default available preference takes the bank-reported available
figure when the checkpoint carries one; with no available field, posted is the
only real figure and is the basis. The figure not chosen stays on the baseline
row as observed evidence so the two can be reconciled. Outgoing holds are
embedded in the starting cash only through a reported available figure. On the
posted basis a reliable outgoing hold is counted once by the dated bill debit,
and the numeric cash total is neither nulled nor debited again.

## Spending room and next cycle

**Payday** remains the actual next income, and its card payoff stays in the
payment ledger. **Cycle funding payday** is the scheduled paycheck that funds
the active spending cycle, `[reset start, next reset)`. The three budget
amounts describe that cycle:

- **Without cash cushion** is the cycle funding paycheck less the card payoff
  assigned to that cycle and the recurring cash bills dated inside the active
  cycle. It can be negative.
- **With cash cushion** adds existing cash after deficits left by earlier
  commitments. An earlier paycheck never raises the cushion above observed
  cash, so its whole amount is not added.
- **After savings goal** deducts the savings target from the paycheck-funded
  amount, not from existing cash. The projected extra cash saved is a change
  to the cash cushion, not to net worth.

A charge belongs to the cycle in which it was spent even when its card payoff
lands in the next funding bucket. The carried slice is subtracted once from
that cycle and removed from the following payoff, so it never deducts two
paychecks. Genuinely next-cycle charges still deduct the following budget.

The cycle amounts include future income and are not all available as cash
today. The separate timing check walks dated payments in order; cash due
before an inflow cannot be funded by that inflow. The monthly savings goal is
applied once, to the after-goal amount. It does not narrow the cash timing
check or the other cycle amounts. When a paycheck, bill, or payoff is unknown,
the dependent cycle amount stays unknown rather than becoming a verified zero
or a positive figure; known cash totals and checkpoints survive.

**Next cycle spending** applies the same dated-ledger selection to the cycle
after the active one, including its own card payoff. When that payoff cannot
be estimated, the next-cycle total stays unknown. The carryover and the
corresponding capacity from the active cycle are the same money. A new
purchase consumes that cash once, even if the card pays later.

The payment and next-cycle bars have different denominators. The former shows
paid versus outstanding obligations; the latter shows two sources of the same
projected allowance. Unknown components or shortfalls are shown as text, not
as misleading segments.

When forecasting from account activity, card payments reduce estimated
outstanding amounts oldest first. This forecast rule does not confirm whether
an issued statement is paid in full. A planned early payment funded by carried
cash uses that cash once; an early payment funded by a later paycheck does not
free up the current cushion for spending today.
A priced pending card purchase is included in the forecast as if it will post.
It is not a posted charge or a scheduled estimate, and the posted purchase
replaces it rather than adding a second expense. An unpriced authorization
affects its own estimate without invalidating a supported closed statement.
A cash shortfall already established before an unknown future payment still
proves there is nothing safe to spend today.

## November 17 example

At the Nov 17 cut the active cycle is Oct 20–Nov 19, funded by the Nov 30
paycheck. With $392 cash and $91.08 due before that payday, the immediate cash
check is $300.92. The $7,449.65 paycheck less the $2,890.56 card payoff leaves
$4,559.09, or $4,059.09 after a $500 savings target. Adding observed cash
gives $4,951.09 of combined room, which is not all cash today.

The following cycle, Nov 20–Dec 19, is funded by the Dec 30 paycheck. The same
$7,449.65 less the $91.08 and $3,963.57 bills dated in that cycle adds
$3,395.00. With no additional spending, the $4,951.09 carries forward once,
for $8,346.09 of projected capacity. These are conditional figures, not a
substitute for checking the dated payments.
