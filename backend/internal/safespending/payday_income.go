package safespending

import (
	"slices"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// claimState separates explicit settlement evidence from an authorization
// that only makes an occurrence uncertain. Equal amounts or nearby dates
// never establish settlement, so only TransactionClaim identities count.
type claimStateResult struct {
	settled map[types.TransactionClaim]bool
	pending map[types.TransactionClaim]bool
}

func claimState(model *types.FinancialModel, cut int64) claimStateResult {
	settled := map[types.TransactionClaim]bool{}
	pending := map[types.TransactionClaim]bool{}
	for _, tx := range model.Transactions {
		if tx.Claim == nil {
			continue
		}
		if posted(tx, cut) {
			settled[*tx.Claim] = true
			continue
		}
		if fact(tx) && tx.Pending && domain.TransactionInstant(&tx) <= cut {
			pending[*tx.Claim] = true
		}
	}
	return claimStateResult{settled: settled, pending: pending}
}

// incomeRules is the single selection of recurring inflows into selected cash.
func incomeRules(st *cutState, model *types.FinancialModel, settings *types.SafeSpendingSettings) []types.Schedule {
	cash := map[string]bool{}
	for _, id := range st.s.SelectedAccountIDs {
		cash[id] = true
	}
	selected := map[string]bool{}
	for _, id := range settings.IncomeScheduleIDs {
		selected[id] = true
	}
	rules := []types.Schedule{}
	for _, rule := range model.Schedules {
		if !rule.Enabled || !selected[rule.ID] || rule.SourceAccountID != nil {
			continue
		}
		if !slices.ContainsFunc(rule.Destinations, func(id string) bool { return cash[id] }) {
			continue
		}
		rules = append(rules, rule)
	}
	return rules
}

type paydayForecast struct {
	date   string
	income *float64
}

// forecastPaydays merges selected occurrences by date. A posted claim has
// already entered cash; a pending claim cannot establish the incoming amount.
// The configured day provides dates, not amounts, when no schedule supplies
// an upcoming payday.
func forecastPaydays(st *cutState, today, payoff string) ([]paydayForecast, bool) {
	rules := incomeRules(st, st.model, st.settings)
	occurrences := domain.ResolveOccurrences(rules, nil, today, domain.AddMonthsClamped(today, 12), true)
	claims := claimState(st.model, st.cut)
	var forecasts []paydayForecast
	for date, rows := range occurrences.ByDate {
		total := 0.0
		known, remaining := true, false
		for _, row := range rows {
			claim := types.TransactionClaim{ScheduleID: row.Rule.ID, OccurrenceDate: date}
			if claims.settled[claim] {
				continue
			}
			remaining = true
			amount, err := st.ctx.resolve(row, date)
			if claims.pending[claim] || err != nil || amount < 0 || !allDestinationsSelected(row.Rule.Destinations, st.selected) {
				known = false
			} else {
				total += amount
			}
		}
		if remaining {
			item := paydayForecast{date: date}
			if known {
				item.income = money(total)
			}
			forecasts = append(forecasts, item)
		}
	}
	if len(forecasts) == 0 {
		reason(&st.s.Reasons, ReasonPaydayUnavailable)
		return []paydayForecast{{date: payoff}}, false
	}
	sort.Slice(forecasts, func(i, j int) bool { return forecasts[i].date < forecasts[j].date })
	if forecasts[0].income == nil {
		reason(&st.s.Reasons, ReasonIncomeUnavailable)
	}
	return forecasts, true
}

func allDestinationsSelected(destinations []string, selected map[string]bool) bool {
	for _, id := range destinations {
		if !selected[id] {
			return false
		}
	}
	return len(destinations) > 0
}
