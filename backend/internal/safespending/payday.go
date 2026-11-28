package safespending

import (
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// defaultClosingDay is the statement closing day used when a card has no
// authored closing day. The card editor persists 1..31; 19 is its default.
const defaultClosingDay = 19

// BuildAtCut forecasts from one factual cut, with independent reset, income
// and card payoff dates.
func BuildAtCut(model *types.FinancialModel, settings *types.SafeSpendingSettings, factualCut int64) types.SafeSpendingSummary {
	if settings == nil {
		settings = &types.SafeSpendingSettings{}
	}
	if model == nil {
		model = &types.FinancialModel{}
	}
	st := cashEvidence(model, settings, factualCut)
	today := st.s.CashAsOf
	cycleDay := calendarDay(settings.CycleStartDay, types.DefaultSafeSpendingCycleStartDay)
	st.s.CycleReset = nextClosingAfter(cycleDay, today)
	st.s.NextCycleEnd = previousIsoDay(nextClosingAfter(cycleDay, st.s.CycleReset))
	st.s.DaysUntilReset = int(domain.MustParseIsoDate(st.s.CycleReset).Sub(domain.MustParseIsoDate(today)).Hours() / 24)

	payoffDay := calendarDay(settings.PaydayDay, types.DefaultSafeSpendingPaydayDay)
	payoff := nextClosingAfter(payoffDay, previousIsoDay(today))
	nextPayoff := nextClosingAfter(payoffDay, payoff)
	st.s.PayoffDate = payoff
	st.s.PaymentPeriodStart = nextIsoDay(lastClosingBefore(payoffDay, payoff))
	incomes, incomeScheduleKnown := forecastPaydays(st, today, payoff)
	st.s.Payday, st.s.ExpectedPay = &incomes[0].date, incomes[0].income
	cycle, following := cycleScopes(cycleDay, payoffDay, today, st.s.CycleReset, incomes, incomeScheduleKnown)
	st.s.CycleStart, st.s.CycleEnd = cycle.start, cycle.end
	if cycle.known {
		st.s.CycleFundingPayday = &cycle.payday
	}

	// The payment period owns the ledger. An unlinked bill from an earlier
	// period is outside its scope, not an unpaid obligation to carry forward.
	start, accountStarts := obligationStart(st, st.s.PaymentPeriodStart)
	horizon := max(nextPayoff, st.s.NextCycleEnd)
	if len(incomes) > 1 {
		horizon = max(horizon, incomes[1].date)
		for _, income := range incomes[2:] {
			if income.date > horizon {
				// Include the bills owned by the final included paycheck, but
				// stop before a paycheck belonging to a later funding period.
				horizon = previousIsoDay(income.date)
				break
			}
		}
	}
	buildObligations(st.s, model, settings, st.selected, st.ctx, st.claims, start, horizon, accountStarts)
	flagPossibleHoldOverlap(st)
	st.s.PrePaydayBills, st.s.PaydayBills = splitObligations(st.s, payoff)
	st.s.StatementReserve = buildStatements(st, payoff)

	nextIncomeDate := nextPayoff
	if len(incomes) > 1 {
		nextIncomeDate = incomes[1].date
	}
	payoffs := []string{payoff}
	for date := nextPayoff; date <= horizon; date = nextClosingAfter(payoffDay, date) {
		payoffs = append(payoffs, date)
	}
	// The following cycle needs its own card liability. Extend only the
	// statement horizon so its payoff is estimated instead of assumed zero.
	if following.payoff > payoffs[len(payoffs)-1] {
		payoffs = append(payoffs, following.payoff)
	}
	reserves, carriedDebt, outsideHorizonDebt := followingStatementReserves(st, payoffs, nextIncomeDate)
	computeForecast(st, incomes, incomeScheduleKnown, nextIncomeDate, horizon, reserves, carriedDebt, outsideHorizonDebt, cycle, following)
	computePaymentProgress(st)
	// Later bills are timeline inputs, not the upcoming payment ledger.
	st.s.Bills = st.s.Bills[:sortedBillsThrough(st.s.Bills, payoff)]
	st.gateStatus()
	return *st.s
}

// splitObligations partitions the single dated bill ledger into obligations
// due before payday and those due on payday. A paid row happened by the
// evidence cut: its movement or hold is already in the cash ledger, so it is
// neither a deduction here nor a reason to withhold the subtotal. A remaining
// group stays unknown when any of its rows has uncertain coverage, so
// ambiguous evidence never becomes zero.
func splitObligations(s *types.SafeSpendingSummary, payday string) (*float64, *float64) {
	// Without a selected income date there is no window to total. The dated
	// bills remain visible as evidence, but neither subtotal is invented.
	if payday == "" {
		return nil, nil
	}
	pre, onPayday := 0.0, 0.0
	preExact, paydayExact := true, true
	for _, bill := range s.Bills {
		if bill.Date > payday {
			continue
		}
		amount, outstanding := billCashDebit(bill)
		if !outstanding {
			continue
		}
		uncertain := amount == nil
		if bill.Date == payday {
			if uncertain {
				paydayExact = false
			} else {
				onPayday += *amount
			}
			continue
		}
		if uncertain {
			preExact = false
		} else {
			pre += *amount
		}
	}
	var before, on *float64
	if preExact {
		before = money(pre)
	}
	if payday != "" && paydayExact {
		on = money(onPayday)
	}
	return before, on
}

func calendarDay(value, fallback int) int {
	if value >= 1 && value <= 31 {
		return value
	}
	return fallback
}

func nextIsoDay(date string) string {
	return domain.FormatIsoDate(domain.MustParseIsoDate(date).AddDate(0, 0, 1))
}

func previousIsoDay(date string) string {
	return domain.FormatIsoDate(domain.MustParseIsoDate(date).AddDate(0, 0, -1))
}

// closingOnOrBefore returns the occurrence of day in the month containing
// anchor, clamped to the last day of shorter months.
func closingOnOrBefore(day int, anchor time.Time) string {
	last := time.Date(anchor.Year(), anchor.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > last {
		day = last
	}
	return fmt.Sprintf("%04d-%02d-%02d", anchor.Year(), int(anchor.Month()), day)
}

func previousMonth(anchor time.Time) time.Time {
	return time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
}

func nextMonth(anchor time.Time) time.Time {
	return time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
}

func lastClosingBefore(day int, date string) string {
	anchor := domain.MustParseIsoDate(date)
	candidate := closingOnOrBefore(day, anchor)
	if candidate >= date {
		candidate = closingOnOrBefore(day, previousMonth(anchor))
	}
	return candidate
}

func nextClosingAfter(day int, date string) string {
	anchor := domain.MustParseIsoDate(date)
	candidate := closingOnOrBefore(day, anchor)
	if candidate <= date {
		candidate = closingOnOrBefore(day, nextMonth(anchor))
	}
	return candidate
}
