package model

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func requireOrdinarySchedule(model *types.FinancialModel, id string) error {
	for _, a := range model.Accounts {
		if a.Display != nil && (a.Display.InterestScheduleID == id || a.Display.PaymentScheduleID == id) {
			return huma.Error409Conflict("Edit this rule through its loan form.")
		}
	}
	return nil
}

// A visible loan selected as a payment destination expands to its explicit
// interest-first routing. Already expanded and multi-destination rows stay
// untouched, preserving advanced account-level instructions.
func displayDestinations(model *types.FinancialModel, ids []string) []string {
	if len(ids) != 1 {
		return ids
	}
	for _, a := range model.Accounts {
		if a.ID != ids[0] || a.Display == nil {
			continue
		}
		for _, c := range a.Display.Components {
			if c.Role == "interest" {
				return []string{c.AccountID, a.ID}
			}
		}
	}
	return ids
}
