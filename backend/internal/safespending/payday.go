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

// BuildAtCut owns the dated payday ledger. Cash evidence is bounded by the
// caller's instant; payday, obligations and statement payoffs are derived from
// that evidence so the two room checks never combine different cash cuts.
func BuildAtCut(model *types.FinancialModel, settings *types.SafeSpendingSettings, factualCut int64) types.SafeSpendingSummary {
	if settings == nil {
		settings = &types.SafeSpendingSettings{}
	}
	if model == nil {
		model = &types.FinancialModel{}
	}
	st := cashEvidence(model, settings, factualCut)
	today := st.s.CashAsOf

	payday, expectedPay, incomeKnown := selectPayday(st, model, settings, today, factualCut)
	if payday != "" {
		st.s.Payday = &payday
	}
	if incomeKnown {
		st.s.ExpectedPay = money(expectedPay)
	}

	// The ledger covers the current income cycle: after the previous payday
	// through the selected payday. That keeps an unclaimed bill that came due
	// earlier in the cycle visible and payable once, without reaching back
	// into older arrears. Without a selected income date there is no cycle
	// boundary, so the ledger starts today over the default horizon.
	start, horizon := today, domain.DefaultScheduleOccurrencesThrough(today)
	if payday != "" {
		horizon = payday
		if previous := previousPayday(st, model, settings, payday); previous != "" {
			start = nextIsoDay(previous)
		}
	}
	buildObligations(st.s, model, settings, st.selected, st.ctx, st.cut, start, horizon)
	preBills, paydayBills := splitObligations(st.s, payday)
	if preBills != nil {
		st.s.PrePaydayBills = preBills
	}
	if paydayBills != nil {
		st.s.PaydayBills = paydayBills
	}

	if reserve := buildStatements(st, model, settings, today, payday, factualCut); reserve != nil {
		st.s.StatementReserve = reserve
	}

	computeRooms(st, incomeKnown)
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
		if bill.Status == "paid" {
			continue
		}
		uncertain := bill.Status != "unpaid" || bill.Amount == nil
		if bill.Date == payday {
			if uncertain {
				paydayExact = false
			} else {
				onPayday += *bill.Amount
			}
			continue
		}
		if uncertain {
			preExact = false
		} else {
			pre += *bill.Amount
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

// computeRooms applies both cash checks. When either check lacks evidence the
// dependent room stays unknown; a negative allowance becomes zero.
func computeRooms(st *cutState, incomeKnown bool) {
	if st.s.CheckingAvailable == nil || st.s.PrePaydayBills == nil {
		return
	}
	cash := *st.s.CheckingAvailable
	st.s.PrePaydayRoom = money(cash - st.s.Reserve - *st.s.PrePaydayBills)
	if st.s.Payday == nil || !incomeKnown || st.s.ExpectedPay == nil || st.s.PaydayBills == nil || st.s.StatementReserve == nil {
		return
	}
	post := cash + *st.s.ExpectedPay - st.s.Reserve - *st.s.PrePaydayBills - *st.s.PaydayBills - *st.s.StatementReserve
	st.s.PostIncomeRoom = money(post)
	room := *st.s.PrePaydayRoom
	if *st.s.PostIncomeRoom < room {
		room = *st.s.PostIncomeRoom
	}
	if room < 0 {
		room = 0
	}
	st.s.SafeToSpend = money(room)
}

func nextIsoDay(date string) string {
	return domain.FormatIsoDate(domain.MustParseIsoDate(date).AddDate(0, 0, 1))
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
