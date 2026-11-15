package safespending

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// effectiveAccounts preserves Configure's non-debt candidates and detected
// checking fallback. Null, empty, and wholly stale selections do not broaden
// the scope to savings or bank cards that happen to have kind cash.
func effectiveAccounts(model *types.FinancialModel, settings *types.SafeSpendingSettings, latest map[string]types.Checkpoint) []string {
	terms := map[string]bool{}
	for _, t := range model.PaymentTerms {
		terms[t.AccountID] = true
	}
	visible := []types.Account{}
	known := map[string]bool{}
	for _, a := range model.Accounts {
		cp, observed := latest[a.ID]
		if terms[a.ID] && observed && cp.Balance > -.005 && cp.Balance < .005 {
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
