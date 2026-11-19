# Safe spending before payday

Safe spending answers one household question: how much unscheduled spending is
affordable before the next selected income date while keeping the reserve and
paying off the selected cards' closed statements? The income schedule sets the
date. Each card's closing day determines which debt belongs in the payoff.

## Two cash checks

The allowance is the smaller of:

- Cash available today less the reserve and outstanding cash obligations before
  payday.
- Cash available today plus expected income on payday, less the reserve, all
  outstanding cash obligations through payday, and the remaining statement
  payoffs planned for payday.

A negative result leaves zero room for extra spending. Missing evidence is
different from zero. Show the known obligations even if the allowance cannot
be determined. The backend owns the calculation and the evidence used to
explain it. Calendar dates use UTC.

For example, suppose checking has $900, the reserve is $200, a $250 bill is
due before payday, and the paycheck is $400. Two cards will need $500 and $150
on payday. There is $450 available before payday, but only $200 after providing
for both payoffs. The household can afford **$200** of unscheduled spending.

## Statement timing and settlement

A closing day of 31 means the last day in a shorter month. Closing a statement
does not withdraw cash. A statement that closed before today can still require
payment, and a statement closing between today and payday can increase the
planned payoff. Identify projected amounts as estimates. Purchases alone do
not establish a historical statement balance.

A scheduled charge on a card belongs in the relevant statement estimate, not
also in cash bills. A card payment affects cash and reduces the outstanding
payoff once. A posted payment claiming a scheduled occurrence replaces that
occurrence. Equal amounts or similar dates alone do not establish settlement.
An available balance can already reflect pending payments, so uncertain payment
coverage must not turn into a precise allowance.
