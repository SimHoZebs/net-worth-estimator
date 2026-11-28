package safespending

import (
	"slices"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// claimState indexes one winning transaction per exact occurrence at the cut.
// A posted settlement always wins over an authorization, regardless of input
// order. The winning transaction and the settled/pending sets are derived
// together so obligations, paydays, and statement replay cannot drift.
type claimStateResult struct {
	byClaim map[types.TransactionClaim]*types.Transaction
	settled map[types.TransactionClaim]bool
	pending map[types.TransactionClaim]bool
}

func claimState(model *types.FinancialModel, cut int64) claimStateResult {
	byClaim := map[types.TransactionClaim]*types.Transaction{}
	for i := range model.Transactions {
		tx := &model.Transactions[i]
		if tx.Claim == nil || !recordedByCut(*tx, cut) {
			continue
		}
		prior := byClaim[*tx.Claim]
		if prior == nil || (prior.Pending && !tx.Pending) {
			byClaim[*tx.Claim] = tx
		}
	}
	settled := map[types.TransactionClaim]bool{}
	pending := map[types.TransactionClaim]bool{}
	for claim, tx := range byClaim {
		if posted(*tx, cut) {
			settled[claim] = true
		} else if tx.Pending {
			pending[claim] = true
		}
	}
	return claimStateResult{byClaim: byClaim, settled: settled, pending: pending}
}

// incomeRules is the single selection of recurring inflows into selected cash.
func incomeRules(st *cutState, model *types.FinancialModel, settings *types.SafeSpendingSettings) []types.Schedule {
	selected := map[string]bool{}
	for _, id := range settings.IncomeScheduleIDs {
		selected[id] = true
	}
	rules := []types.Schedule{}
	for _, rule := range model.Schedules {
		if !rule.Enabled || !selected[rule.ID] || rule.SourceAccountID != nil {
			continue
		}
		if !slices.ContainsFunc(rule.Destinations, func(id string) bool { return st.selected[id] }) {
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
	claims := st.claims
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
