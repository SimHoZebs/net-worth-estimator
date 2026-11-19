package safespending

import (
	"slices"

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

// incomeRules is the single selection of recurring inflows into a selected
// cash account. Both the next payday and the previous cycle boundary use it,
// so the obligation window cannot disagree with the income window.
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

// previousPayday is the latest selected income occurrence strictly before the
// next payday. It bounds the current income cycle: obligations after it and
// through payday belong here, while the boundary occurrence itself belongs to
// the previous cycle. Claims are ignored because a settled payday is still a
// cycle boundary. Returning empty means no earlier boundary is known.
func previousPayday(st *cutState, model *types.FinancialModel, settings *types.SafeSpendingSettings, payday string) string {
	rules := incomeRules(st, model, settings)
	if len(rules) == 0 {
		return ""
	}
	// The lookback boundary is inclusive: an annual income occurrence lands
	// exactly 12 months back and is still the previous cycle boundary. Payday
	// itself is filtered out below.
	occurrences := domain.ResolveOccurrences(rules, nil, domain.AddMonthsClamped(payday, -12), payday, true)
	previous := ""
	for date := range occurrences.ByDate {
		if date < payday && (previous == "" || date > previous) {
			previous = date
		}
	}
	return previous
}

// selectPayday resolves the next selected income occurrence. Only recurring
// inflows into a selected cash account are candidates, so a scheduled outflow
// or a transfer cannot masquerade as pay. An occurrence dated today counts
// unless a posted payment explicitly claims it; counting it a second time is
// then impossible because the claim already advanced the observed cash.
func selectPayday(st *cutState, model *types.FinancialModel, settings *types.SafeSpendingSettings, today string, cut int64) (string, float64, bool) {
	rules := incomeRules(st, model, settings)
	if len(rules) == 0 {
		reason(&st.s.Reasons, ReasonPaydayUnavailable)
		return "", 0, false
	}

	occurrences := domain.ResolveOccurrences(rules, nil, today, domain.AddMonthsClamped(today, 12), true)
	claims := claimState(model, cut)
	remaining := map[string][]domain.DatedTransactionOccurrence{}
	for date, rows := range occurrences.ByDate {
		for _, row := range rows {
			if row.Rule == nil {
				continue
			}
			claim := types.TransactionClaim{ScheduleID: row.Rule.ID, OccurrenceDate: date}
			if claims.settled[claim] {
				continue
			}
			remaining[date] = append(remaining[date], row)
		}
	}
	if len(remaining) == 0 {
		reason(&st.s.Reasons, ReasonPaydayUnavailable)
		return "", 0, false
	}

	payday := ""
	for date := range remaining {
		if payday == "" || date < payday {
			payday = date
		}
	}
	expected := 0.0
	known := true
	for _, row := range remaining[payday] {
		claim := types.TransactionClaim{ScheduleID: row.Rule.ID, OccurrenceDate: payday}
		if claims.pending[claim] {
			reason(&st.s.Reasons, ReasonIncomeUnavailable)
			known = false
			continue
		}
		amount, err := st.ctx.resolve(row, payday)
		if err != nil || amount < 0 {
			reason(&st.s.Reasons, ReasonIncomeUnavailable)
			known = false
			continue
		}
		expected += amount
	}
	return payday, expected, known
}
