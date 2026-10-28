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

func validatePlannedPurchaseCost(cost float64, id string) error {
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 {
		return fmt.Errorf("Planned purchase '%s' needs a fixed positive cost.", id)
	}
	return nil
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
	accountIDs := map[string]bool{}
	for _, account := range document.Accounts {
		accountIDs[account.ID] = true
	}
	for index := range document.PlannedPurchases {
		p := &document.PlannedPurchases[index]
		base := []any{"plannedPurchases", index}
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
	for _, movement := range ResolvedMovementPostings(document) {
		for _, dependency := range dependencies[movement.ID] {
			if purchases[dependency] {
				addIssue(issues, types.SeverityError, "purchase.reference.invalid", "Amounts cannot depend on a planned purchase.", "postings")
			}
		}
	}
}
