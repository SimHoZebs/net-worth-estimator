package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func purchaseCost(posting *types.Posting) (float64, error) {
	expression, _ := posting.Amount.Config["expression"].(string)
	cost, err := strconv.ParseFloat(strings.TrimSpace(expression), 64)
	if posting.Amount.Resolver != "expression" || len(posting.Amount.Inputs) != 0 || err != nil || math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 {
		return 0, fmt.Errorf("Purchase '%s' needs a fixed positive cost.", posting.ID)
	}
	return cost, nil
}

func validatePurchases(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, dependencies map[string][]string) {
	purchases := map[string]bool{}
	for index := range document.Postings {
		posting := &document.Postings[index]
		if posting.Purchase == nil {
			continue
		}
		purchases[posting.ID] = true
		path := []any{"postings", index, "purchase"}
		if posting.Purchase.Priority < 0 {
			addIssue(issues, types.SeverityError, "purchase.priority.invalid", "Purchase priority must be nonnegative.", path...)
		}
		if !IsExternalOutflow(posting) || posting.Claim != nil {
			addIssue(issues, types.SeverityError, "purchase.route.invalid", "A purchase must be an external outflow with a funding account and no occurrence claim.", path...)
		}
		if _, err := purchaseCost(posting); err != nil {
			addIssue(issues, types.SeverityError, "purchase.cost.invalid", err.Error(), "postings", index, "amount")
		}
	}
	// Established payments cannot depend on an optional, unscheduled purchase.
	for _, movement := range ResolvedMovementPostings(document) {
		for _, dependency := range dependencies[movement.ID] {
			if purchases[dependency] {
				addIssue(issues, types.SeverityError, "purchase.reference.invalid", "Amounts cannot depend on a planned purchase.", "postings")
			}
		}
	}
}
