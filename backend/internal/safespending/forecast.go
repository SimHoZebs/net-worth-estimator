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

func computeForecast(st *cutState, incomes []paydayForecast, incomeScheduleKnown bool, nextIncomeDate, end string, reserves []statementPayoff, carriedDebt, outsideHorizonDebt *float64, cycle, following cycleBudgetScope) {
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
		s.SpendableCash = money(*cashBeforeIncome)
		s.PrePaydayRoom = s.SpendableCash
	}
	s.PostPaydayBalance, s.PaymentRoom = timeline.checkpoint(s.CheckingAvailable, payoff)
	if s.PostPaydayBalance != nil {
		s.PostIncomeRoom = s.PostPaydayBalance
	} else {
		s.PostIncomeRoom = nil
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
	if fullMinimum != nil && *fullMinimum <= 0 || fundingMinimum != nil && *fundingMinimum <= 0 {
		s.SafeToSpend = money(0)
	} else if fundingBalance != nil && endBalance != nil {
		s.SafeToSpend = money(max(0, min(*fundingMinimum, *fullMinimum)))
	}
	// The cycle budget is independent of the cash timeline: it belongs to the
	// paycheck funding the active spending cycle, not the upcoming payoff.
	computeCycleBudget(st, incomes, reserves, carriedDebt, outsideHorizonDebt, nextIncomeDate, cycle)
	computeFollowingBudget(st, incomes, reserves, carriedDebt, nextIncomeDate, following)
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
