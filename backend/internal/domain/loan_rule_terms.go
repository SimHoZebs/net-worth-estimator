package domain

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

var loanPaymentLiteral = regexp.MustCompile(`(?i)^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$`)

// LoanRuleTerms accepts exactly the periodic simple-interest and fixed-payment
// rules the loan form can represent. Unknown formulas never become zero.
func LoanRuleTerms(principalID string, charge, payment types.Schedule) (annualRate, paymentAmount float64, rateInput string, err error) {
	unsupported := fmt.Errorf("loan rules must use principal-only periodic simple interest and a fixed payment, without end dates or annual caps")
	if charge.EndDate != nil || payment.EndDate != nil || charge.AnnualCap != nil || payment.AnnualCap != nil || charge.Amount.Resolver != "expression" || payment.Amount.Resolver != "expression" || len(charge.Amount.Inputs) != 2 || len(payment.Amount.Inputs) != 0 {
		return 0, 0, "", unsupported
	}
	principalInput := ""
	for key, input := range charge.Amount.Inputs {
		if input.Source != "provider" {
			return 0, 0, "", unsupported
		}
		switch input.Provider {
		case "model-value":
			if input.Arguments["id"] != principalID || len(input.Arguments) != 1 {
				return 0, 0, "", unsupported
			}
			principalInput = key
		case "occurrence-rate":
			value, ok := input.Arguments["annualRate"].(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 || len(input.Arguments) != 2 {
				return 0, 0, "", unsupported
			}
			volatility, ok := input.Arguments["volatility"].(float64)
			if !ok || volatility != 0 {
				return 0, 0, "", unsupported
			}
			annualRate, rateInput = value, key
		default:
			return 0, 0, "", unsupported
		}
	}
	expression, ok := charge.Amount.Config["expression"].(string)
	if !ok || principalInput == "" || rateInput == "" || strings.Join(strings.Fields(expression), "") != "abs("+principalInput+")*"+rateInput {
		return 0, 0, "", unsupported
	}
	literal, ok := payment.Amount.Config["expression"].(string)
	if !ok || !loanPaymentLiteral.MatchString(strings.TrimSpace(literal)) {
		return 0, 0, "", unsupported
	}
	paymentAmount, err = strconv.ParseFloat(strings.TrimSpace(literal), 64)
	if err != nil || math.IsNaN(paymentAmount) || math.IsInf(paymentAmount, 0) || paymentAmount < 0 || paymentAmount > 1e10 || math.Round(paymentAmount*100)/100 != paymentAmount {
		return 0, 0, "", unsupported
	}
	return annualRate, paymentAmount, rateInput, nil
}
