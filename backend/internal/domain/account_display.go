package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// BuildLoan compiles the form to existing financial primitives. Saved IDs
// preserve history when terms change.
func BuildLoan(id, interestID, interestRuleID, paymentRuleID string, terms types.LoanTerms) (types.LoanBundle, error) {
	if strings.TrimSpace(terms.Name) == "" || terms.ObservedAt <= 0 || terms.FundingAccountID == "" || terms.FundingAccountID == id || terms.FundingAccountID == interestID {
		return types.LoanBundle{}, fmt.Errorf("enter a name, exact observation time, and a separate funding account")
	}
	for _, amount := range []float64{terms.Principal, terms.AccruedInterest, terms.Payment, terms.AnnualRate} {
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > 1e10 {
			return types.LoanBundle{}, fmt.Errorf("loan amounts must be finite and nonnegative")
		}
	}
	if terms.AnnualRate > 1 {
		return types.LoanBundle{}, fmt.Errorf("annual rate must be between zero and one")
	}
	zero := 0.0
	name := strings.TrimSpace(terms.Name)
	display := &types.AccountDisplay{Name: name, Components: []types.AccountComponent{{AccountID: id, Role: "principal"}, {AccountID: interestID, Role: "interest"}}, InterestScheduleID: interestRuleID, PaymentScheduleID: paymentRuleID}
	principal := types.Account{ID: id, Name: name + " (Principal)", Kind: "debt", MaxBalance: &zero, Enabled: terms.Enabled, Display: display}
	interest := types.Account{ID: interestID, Name: name + " (Interest)", Kind: "debt", MaxBalance: &zero, Enabled: terms.Enabled}
	charge := types.Schedule{ID: interestRuleID, Name: name + " Interest", SourceAccountID: &interestID, Frequency: terms.InterestFrequency, StartDate: terms.InterestStartDate, Enabled: terms.Enabled, Priority: 6,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "abs(principal) * rate"}, Inputs: map[string]types.AmountInputBinding{
			"principal": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": id}},
			"rate":      {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": terms.AnnualRate, "volatility": 0.0}},
		}}}
	payment := types.Schedule{ID: paymentRuleID, Name: name + " Payment", SourceAccountID: &terms.FundingAccountID, Destinations: []string{interestID, id}, Frequency: terms.PaymentFrequency, StartDate: terms.PaymentStartDate, Enabled: terms.Enabled, Priority: 7,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": fmt.Sprintf("%g", terms.Payment)}, Inputs: map[string]types.AmountInputBinding{}}}
	return types.LoanBundle{Accounts: []types.Account{principal, interest}, Checkpoints: []types.Checkpoint{{AccountID: id, Balance: -terms.Principal, ObservedAt: terms.ObservedAt, Source: "user"}, {AccountID: interestID, Balance: -terms.AccruedInterest, ObservedAt: terms.ObservedAt, Source: "user"}}, Schedules: []types.Schedule{charge, payment}}, nil
}

func validateAccountDisplays(issues *[]types.ModelValidationIssue, model *types.FinancialModel) {
	accounts := map[string]types.Account{}
	rules := map[string]types.Schedule{}
	for _, a := range model.Accounts {
		accounts[a.ID] = a
	}
	for _, r := range model.Schedules {
		rules[r.ID] = r
	}
	claimed := map[string]bool{}
	for i, a := range model.Accounts {
		d := a.Display
		if d == nil {
			continue
		}
		invalid := strings.TrimSpace(d.Name) == "" || len(d.Components) != 2
		roles := map[string]string{}
		for _, c := range d.Components {
			member, exists := accounts[c.AccountID]
			// Loan linkage is structural, never kind-gated: exclusive
			// principal and interest components, matching inclusion,
			// zero ceilings, and consistent rules. The frontend suggests
			// debt-kind accounts when configuring the link.
			if !exists || claimed[c.AccountID] || member.Enabled != a.Enabled || member.MaxBalanceValue() != 0 || (member.Display != nil && member.ID != a.ID) || roles[c.Role] != "" {
				invalid = true
			}
			claimed[c.AccountID] = true
			roles[c.Role] = c.AccountID
		}
		charge, chargeExists := rules[d.InterestScheduleID]
		payment, paymentExists := rules[d.PaymentScheduleID]
		if _, _, _, err := LoanRuleTerms(a.ID, charge, payment); err != nil || charge.Enabled != a.Enabled || payment.Enabled != a.Enabled {
			invalid = true
		}
		if roles["principal"] != a.ID || roles["interest"] == "" || !chargeExists || !paymentExists || charge.SourceAccountID == nil || *charge.SourceAccountID != roles["interest"] || len(charge.Destinations) != 0 || len(payment.Destinations) != 2 || payment.Destinations[0] != roles["interest"] || payment.Destinations[1] != a.ID {
			invalid = true
		}
		if invalid {
			addIssue(issues, types.SeverityError, "account.display.invalid", "A loan needs exclusive principal and interest components, matching inclusion, zero ceilings, and its interest and payment rules.", "accounts", i, "display")
		}
	}
}
