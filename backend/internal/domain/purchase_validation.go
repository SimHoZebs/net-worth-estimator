package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func validatePlannedPurchaseCost(cost float64, id string) error {
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 {
		return fmt.Errorf("Planned purchase '%s' needs a fixed positive cost.", id)
	}
	return nil
}

func validatePurchases(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, dependencies map[string][]string) {
	purchases := map[string]bool{}
	accountIDs := map[string]bool{}
	for _, account := range document.Accounts {
		accountIDs[account.ID] = true
	}
	for index := range document.PlannedPurchases {
		p := &document.PlannedPurchases[index]
		base := []any{"plannedPurchases", index}
		if strings.TrimSpace(p.Name) == "" {
			addIssue(issues, types.SeverityError, "purchase.name.empty", "A planned purchase needs a name.", append(base, "name")...)
		}
		if p.Priority < 0 {
			addIssue(issues, types.SeverityError, "purchase.priority.invalid", "Purchase priority must be nonnegative.", append(base, "priority")...)
		}
		if err := validatePlannedPurchaseCost(p.Cost, p.ID); err != nil {
			addIssue(issues, types.SeverityError, "purchase.cost.invalid", err.Error(), append(base, "cost")...)
		}
		if p.FundingAccountID == nil || !accountIDs[*p.FundingAccountID] {
			addIssue(issues, types.SeverityError, "purchase.route.invalid", "A planned purchase needs a funding account that exists.", append(base, "fundingAccountId")...)
		}
		if !IsValidIsoDate(p.EarliestDate) {
			addIssue(issues, types.SeverityError, "purchase.date.invalid", "Planned purchase earliestDate must be a YYYY-MM-DD calendar date.", append(base, "earliestDate")...)
		}
		purchases[p.ID] = true
	}
	// Established payments cannot depend on an optional, unscheduled purchase.
	for _, transaction := range ResolvedTransactionPostings(document) {
		for _, dependency := range dependencies[transaction.ID] {
			if purchases[dependency] {
				addIssue(issues, types.SeverityError, "purchase.reference.invalid", "Amounts cannot depend on a planned purchase.", "postings")
			}
		}
	}
}
