package safespending

import (
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type cashDay struct {
	income, outgoing           float64
	incomeUnknown, debtUnknown bool
}

type cashFlow map[string]*cashDay

func (f cashFlow) at(date string) *cashDay {
	if f[date] == nil {
		f[date] = &cashDay{}
	}
	return f[date]
}

// checkpoint checks opening cash and every dated debit. Overdue bills are
// due immediately. Income on a date is assumed to arrive before that date's
// planned payments, but never finances a payment dated earlier. If an
// unpriced event prevents an ending balance, low still describes the known
// prefix. A later event cannot repair a shortfall at an earlier checkpoint.
func (f cashFlow) checkpoint(opening *float64, through string) (balance, low *float64) {
	if opening == nil {
		return nil, nil
	}
	dates := make([]string, 0, len(f))
	for date := range f {
		if date <= through {
			dates = append(dates, date)
		}
	}
	sort.Strings(dates)
	cash, minimum := *opening, *opening
	for _, date := range dates {
		day := f[date]
		if day.incomeUnknown || day.debtUnknown {
			return nil, money(minimum)
		}
		cash += day.income - day.outgoing
		minimum = min(minimum, cash)
	}
	return money(cash), money(minimum)
}

func (d *cashDay) debit(amount *float64) {
	if amount == nil {
		d.debtUnknown = true
	} else {
		d.outgoing += *amount
	}
}

func (f cashFlow) net() *float64 {
	net := 0.0
	for _, day := range f {
		if day.incomeUnknown || day.debtUnknown {
			return nil
		}
		net += day.income - day.outgoing
	}
	return money(net)
}

func computeForecast(st *cutState, incomes []paydayForecast, incomeScheduleKnown bool, nextIncomeDate, end string, reserves []statementPayoff, carriedDebt, outsideHorizonDebt *float64) {
	s := st.s
	today, payoff := s.CashAsOf, s.PayoffDate
	timeline, current, next := cashFlow{}, cashFlow{}, cashFlow{}
	bucket := func(date string) cashFlow {
		if date < nextIncomeDate {
			return current
		}
		return next
	}
	for _, bill := range s.Bills {
		// Posted payments are reflected in cash. A pending payment debits
		// only the part of the estimate not already covered by its hold.
		amount, outstanding := billCashDebit(bill)
		if !outstanding {
			continue
		}
		date := max(today, bill.Date)
		timeline.at(date).debit(amount)
		bucket(date).at(date).debit(amount)
	}
	for _, income := range incomes {
		if income.date > end {
			break
		}
		for _, flow := range []cashFlow{timeline, bucket(income.date)} {
			day := flow.at(income.date)
			if income.income == nil {
				day.incomeUnknown = true
			} else {
				day.income += *income.income
			}
		}
	}
	beforeIncome := previousIsoDay(*s.Payday)
	s.CardPayoffCapacity, _ = timeline.checkpoint(s.CheckingAvailable, payoff)
	for _, reserve := range reserves {
		timeline.at(reserve.date).debit(reserve.amount)
		bucket(reserve.date).at(reserve.date).debit(reserve.amount)
	}

	cashBeforeIncome, _ := timeline.checkpoint(s.CheckingAvailable, beforeIncome)
	if cashBeforeIncome != nil {
		s.SpendableCash = money(*cashBeforeIncome - s.Reserve)
		s.PrePaydayRoom = s.SpendableCash
	}
	s.PostPaydayBalance, s.PaymentRoom = timeline.checkpoint(s.CheckingAvailable, payoff)
	if s.PostPaydayBalance != nil {
		s.PostIncomeRoom = money(*s.PostPaydayBalance - s.Reserve)
	} else {
		s.PaymentRoom = nil // The exact payoff checkpoint is still unknown.
	}
	endBalance, fullMinimum := timeline.checkpoint(s.CheckingAvailable, end)
	if endBalance != nil || fullMinimum != nil && *fullMinimum < 0 {
		s.ForecastCashRoom = fullMinimum
	}
	// Reserve current-cycle card debt actually paid in the next funding
	// bucket, without adding another bank withdrawal. Current-funded
	// payoffs and explicit card payments are already present on the timeline.
	fundingThrough := previousIsoDay(nextIncomeDate)
	carryoverDate := max(fundingThrough, *s.Payday)
	current.at(carryoverDate).debit(carriedDebt)
	// The payoff is outside both funding buckets; only the reservation belongs
	// here. There is no debit in next to offset.
	current.at(carryoverDate).debit(outsideHorizonDebt)
	if carriedDebt == nil {
		next.at(carryoverDate).debit(nil)
	} else {
		next.at(carryoverDate).debit(money(-*carriedDebt))
	}
	timeline.at(fundingThrough).debit(carriedDebt)
	timeline.at(fundingThrough).debit(outsideHorizonDebt)
	fundingBalance, fundingMinimum := timeline.checkpoint(s.CheckingAvailable, fundingThrough)
	if fullMinimum != nil && *fullMinimum <= s.Reserve || fundingMinimum != nil && *fundingMinimum <= s.Reserve {
		s.SafeToSpend = money(0)
	} else if fundingBalance != nil && endBalance != nil {
		s.SafeToSpend = money(max(0, min(*fundingMinimum, *fullMinimum)-s.Reserve))
	}
	// FundingRoom is the cycle budget with the existing cash cushion: the
	// first paycheck funds the spending, the dated bills and card payoffs it
	// owns are debited once, and the cash left before that paycheck is added.
	// The reserve protects only the cash checkpoints above, so it must not
	// move this value or the next-cycle budget derived from it.
	if net := current.net(); net != nil && s.CheckingAvailable != nil {
		s.FundingRoom = money(*s.CheckingAvailable + *net)
		s.NextCycleCarryover = s.FundingRoom
	}
	// IncomeFunded is the same cycle budget without the cash cushion. Pre-income
	// obligations are already deducted from spendable cash, so limiting the net
	// to payday and later does not subtract those bills twice.
	incomeFunded := cashFlow{}
	for date, day := range current {
		if date > beforeIncome {
			incomeFunded[date] = day
		}
	}
	s.IncomeFunded = incomeFunded.net()
	if s.IncomeFunded != nil {
		s.SavingsAllowance = money(*s.IncomeFunded - st.settings.SavingsTarget)
		s.AdditionalSavings = s.IncomeFunded
	}
	if incomeScheduleKnown && len(incomes) > 1 {
		s.NextCycleIncome = next.net()
	}
	if s.NextCycleIncome != nil && s.NextCycleCarryover != nil {
		s.NextCycleDiscretionary = money(*s.NextCycleIncome + *s.NextCycleCarryover)
	}
}

func sortedBillsThrough(bills []types.SafeSpendingBill, date string) int {
	return sort.Search(len(bills), func(i int) bool { return bills[i].Date > date })
}

// obligationStart fixes the occurrence ledger at the current payment period.
// An occurrence due before that boundary belongs to an earlier period. Being
// unlinked is not evidence that it was paid, and it does not make the bill an
// unpaid obligation either, so observation history must not pull it back into
// the forecast. An exact posted settlement inside the current window is carried
// separately into the ledger by buildObligations, where it bars its occurrence.
func obligationStart(st *cutState, paymentStart string) (start string, accounts map[string]string) {
	accounts = make(map[string]string, len(st.selected))
	for id := range st.selected {
		accounts[id] = paymentStart
	}
	return paymentStart, accounts
}
