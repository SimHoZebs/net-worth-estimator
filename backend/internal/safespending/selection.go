package safespending

import (
	"slices"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Configure falls back to all eligible bills when no stored ID survives.
func effectiveBills(rules []types.Schedule, cash map[string]bool, stored []string) []types.Schedule {
	all, chosen := []types.Schedule{}, []types.Schedule{}
	for _, rule := range rules {
		if !rule.Enabled || rule.SourceAccountID == nil || !cash[*rule.SourceAccountID] {
			continue
		}
		if len(rule.Destinations) > 0 && !slices.ContainsFunc(rule.Destinations, func(id string) bool { return !cash[id] }) {
			continue
		}
		all = append(all, rule)
		if slices.Contains(stored, rule.ID) {
			chosen = append(chosen, rule)
		}
	}
	if len(chosen) != 0 {
		return chosen
	}
	return all
}

// effectiveAccounts preserves Configure's non-debt candidates and detected
// checking fallback. Null, empty, and wholly stale selections do not broaden
// the scope to savings or bank cards that happen to have kind cash.
func effectiveAccounts(model *types.FinancialModel, settings *types.SafeSpendingSettings, latest map[string]types.Checkpoint) []string {
	terms := domain.PaymentTermsByAccount(model)
	visible := []types.Account{}
	known := map[string]bool{}
	for _, a := range model.Accounts {
		cp, observed := latest[a.ID]
		if _, termed := terms[a.ID]; termed && observed && cp.Balance > -.005 && cp.Balance < .005 {
			continue
		}
		visible = append(visible, a)
		if a.Kind != types.AccountKindDebt {
			known[a.ID] = true
		}
	}
	selected := []string{}
	seen := map[string]bool{}
	for _, id := range settings.SpendingAccountIDs {
		if known[id] && !seen[id] {
			selected = append(selected, id)
			seen[id] = true
		}
	}
	if len(selected) > 0 {
		return selected
	}
	fallback := ""
	for _, a := range visible {
		if a.ID == "checking" {
			fallback = a.ID
			break
		}
	}
	if fallback == "" {
		for _, a := range visible {
			if a.Kind == types.AccountKindCash && a.Enabled {
				fallback = a.ID
				break
			}
		}
	}
	if fallback == "" {
		for _, a := range visible {
			if a.Kind == types.AccountKindCash {
				fallback = a.ID
				break
			}
		}
	}
	if known[fallback] {
		selected = append(selected, fallback)
	}
	return selected
}
