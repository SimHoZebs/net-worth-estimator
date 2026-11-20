package safespending

// cycleBudgetScope names the paycheck that funds one spending cycle. The
// cycle runs from its reset day through the day before the next reset; its
// card spending closes in that window and is paid at the following configured
// payoff. Bills with dates inside the cycle are funded by that same paycheck.
type cycleBudgetScope struct {
	start, end, payday, payoff string
	known                      bool
}

// cycleScopes resolves the active cycle and the following one from one
// evidence cut. A reset day begins the new cycle, so the active window starts
// on the reset itself. The funding payday is the actual scheduled income on or
// after the cycle's payoff; without income evidence the configured payoff is
// kept for arithmetic but the scope is not reported as known.
func cycleScopes(cycleDay, payoffDay int, today, reset string, incomes []paydayForecast, incomeScheduleKnown bool) (cycleBudgetScope, cycleBudgetScope) {
	start := lastClosingBefore(cycleDay, nextIsoDay(today))
	end := previousIsoDay(reset)
	current := cycleBudgetScope{start: start, end: end, payoff: nextClosingAfter(payoffDay, end)}
	current.payday, current.known = fundingDate(incomes, incomeScheduleKnown, current.payoff)

	followingStart := nextIsoDay(end)
	followingEnd := previousIsoDay(nextClosingAfter(cycleDay, followingStart))
	following := cycleBudgetScope{start: followingStart, end: followingEnd, payoff: nextClosingAfter(payoffDay, followingEnd)}
	following.payday, following.known = fundingDate(incomes, incomeScheduleKnown, following.payoff)
	return current, following
}

func fundingDate(incomes []paydayForecast, incomeScheduleKnown bool, payoff string) (string, bool) {
	if !incomeScheduleKnown {
		return payoff, false
	}
	for _, income := range incomes {
		if income.date >= payoff {
			return income.date, true
		}
	}
	return payoff, false
}

// computeCycleBudget derives the paycheck-funded amounts from the dated bill
// ledger, the statement payoff due on the configured payoff date, and the
// scheduled income on the funding payday. The cash cushion is observed cash
// reduced by deficits left by earlier commitments, never increased by a whole
// earlier paycheck. An unknown income, bill, or payoff leaves the dependent
// total unknown rather than turning it into zero or a verified positive number.
func computeCycleBudget(st *cutState, incomes []paydayForecast, reserves []statementPayoff, carriedDebt, outsideHorizonDebt *float64, nextIncomeDate string, scope cycleBudgetScope) {
	cycle, prior := cashFlow{}, cashFlow{}
	for _, bill := range st.s.Bills {
		amount, outstanding := billCashDebit(bill)
		if !outstanding {
			continue
		}
		switch {
		case bill.Date >= scope.start && bill.Date <= scope.end:
			cycle.at(bill.Date).debit(amount)
		case bill.Date < scope.start:
			prior.at(bill.Date).debit(amount)
		}
		// A bill between cycles belongs to exactly one of the cycle windows;
		// it is never charged to both a paycheck and a second cycle.
	}
	addIncome := func(flow cashFlow, date string, income paydayForecast) {
		day := flow.at(date)
		if income.income == nil {
			day.incomeUnknown = true
		} else {
			day.income += *income.income
		}
	}
	for _, income := range incomes {
		switch {
		case income.date == scope.payday:
			addIncome(cycle, income.date, income)
		case income.date < scope.payday:
			addIncome(prior, income.date, income)
		}
	}
	if !scope.known {
		cycle.at(scope.payday).incomeUnknown = true
	}
	for _, reserve := range reserves {
		switch {
		case reserve.date == scope.payoff:
			// The card payoff follows the configured payoff date even when the
			// selected paycheck lands on a different day.
			cycle.at(scope.payoff).debit(reserve.amount)
		case reserve.date < scope.start:
			prior.at(reserve.date).debit(reserve.amount)
		}
	}
	// Charges incurred in this spend cycle are owned by it even when their
	// card payoff lands in the next funding bucket. When that payoff is still
	// ahead of this cycle's payoff it is not in the dated reserve row, so
	// reserve the slice here once.
	if scope.payoff < nextIncomeDate {
		cycle.at(scope.payoff).debit(carriedDebt)
	}
	// Current-cycle charges whose payoff falls past the reserve horizon are
	// carried to the configured payoff once; the dated rows omit them.
	cycle.at(scope.payoff).debit(outsideHorizonDebt)
	// IncomeFunded and the after-goal amount do not depend on cash evidence.
	st.s.IncomeFunded = cycle.net()
	st.s.AdditionalSavings = st.s.IncomeFunded
	if st.s.IncomeFunded != nil {
		st.s.SavingsAllowance = money(*st.s.IncomeFunded - st.settings.SavingsTarget)
	}
	// FundingRoom adds only deficits left by earlier commitments. An earlier
	// paycheck cannot lift the cushion above observed cash. When an earlier
	// flow is unknown its deficit is not invented: the cushion stays at
	// observed cash, leaving FundingRoom an upper bound rather than a verified
	// shortfall. Missing cash leaves the cushion unknown without erasing the
	// paycheck-funded amount.
	if st.s.CheckingAvailable != nil && st.s.IncomeFunded != nil {
		cushion := *st.s.CheckingAvailable
		if net := prior.net(); net != nil && *net < 0 {
			cushion += *net
		}
		st.s.FundingRoom = money(cushion + *st.s.IncomeFunded)
		st.s.NextCycleCarryover = st.s.FundingRoom
	}
}

// computeFollowingBudget applies the same dated-ledger selection to the
// following cycle so the next-cycle income describes that cycle rather than
// an unbounded horizon. Its own card payoff is part of those dues. When that
// payoff has no estimate the total stays unknown; known cash and cycle
// amounts elsewhere are left intact.
func computeFollowingBudget(st *cutState, incomes []paydayForecast, reserves []statementPayoff, carriedDebt *float64, nextIncomeDate string, scope cycleBudgetScope) {
	cycle := cashFlow{}
	for _, bill := range st.s.Bills {
		amount, outstanding := billCashDebit(bill)
		if !outstanding || bill.Date < scope.start || bill.Date > scope.end {
			continue
		}
		cycle.at(bill.Date).debit(amount)
	}
	for _, income := range incomes {
		if income.date != scope.payday {
			continue
		}
		day := cycle.at(income.date)
		if income.income == nil {
			day.incomeUnknown = true
		} else {
			day.income += *income.income
		}
	}
	payoffKnown := false
	for _, reserve := range reserves {
		if reserve.date != scope.payoff {
			continue
		}
		payoffKnown = true
		if reserve.amount == nil || (carriedDebt == nil && scope.payoff <= nextIncomeDate) {
			cycle.at(scope.payoff).debit(nil)
			continue
		}
		// A payoff at or just after the next income still carries this cycle's
		// spending. Remove that slice so only genuine next-cycle card spending
		// deducts the following paycheck.
		amount := *reserve.amount
		if carriedDebt != nil && scope.payoff <= nextIncomeDate {
			amount -= *carriedDebt
		}
		cycle.at(scope.payoff).debit(money(amount))
	}
	if !payoffKnown {
		cycle.at(scope.payoff).debit(nil)
	}
	if !scope.known {
		// Without a selected income there is no verified paycheck amount.
		cycle.at(scope.payday).incomeUnknown = true
	}
	st.s.NextCycleIncome = cycle.net()
}
