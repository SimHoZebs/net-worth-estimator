package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Evaluation configuration validation and normalization. Kept beside validation
// so model cross-validation and evaluation runtimes share one source of truth.

func finiteNonNegative(value, fallback float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	return math.Max(0, value)
}

// NormalizeFIPlan normalizes source selection, rates, confidence, and evaluation
// years for financial-independence evaluation.
func NormalizeFIPlan(plan types.FIPlan) types.FIPlan {
	sources := make([]types.FISource, len(plan.Sources))
	for i, source := range plan.Sources {
		if source.Type == "cashflow" {
			sources[i] = source
			continue
		}
		if source.WithdrawalRateOverride != nil {
			clamped := math.Min(1, finiteNonNegative(*source.WithdrawalRateOverride, 0))
			source.WithdrawalRateOverride = &clamped
		}
		sources[i] = source
	}
	spendableIncomeIDs := map[string]bool{}
	for _, source := range sources {
		if source.Type == "cashflow" && source.Included {
			spendableIncomeIDs[source.TransactionID] = true
		}
	}
	basis := types.ExpenseBasisFIDateDollars
	if plan.AnnualExpenseTargetBasis == types.ExpenseBasisProjectionStart {
		basis = types.ExpenseBasisProjectionStart
	}
	evaluationYears := int(math.Floor(finiteNonNegative(float64(plan.EvaluationYears), 1)))
	if evaluationYears < 1 {
		evaluationYears = 1
	}
	requiredConfidence := math.Min(1, math.Max(0.01, finiteNonNegative(plan.RequiredConfidence, 1)))
	continuing := []string{}
	seenContinuing := map[string]bool{}
	for _, id := range plan.ContinuingTransactionIDs {
		if seenContinuing[id] || spendableIncomeIDs[id] {
			continue
		}
		seenContinuing[id] = true
		continuing = append(continuing, id)
	}
	return types.FIPlan{
		MinimumNetWorth:          finiteNonNegative(plan.MinimumNetWorth, 0),
		AnnualExpenseTarget:      finiteNonNegative(plan.AnnualExpenseTarget, 0),
		AnnualExpenseTargetBasis: basis,
		AnnualExpenseGrowthRate:  finiteNonNegative(plan.AnnualExpenseGrowthRate, 0),
		WithdrawalRate:           math.Min(1, finiteNonNegative(plan.WithdrawalRate, 0)),
		EvaluationYears:          evaluationYears,
		RequiredConfidence:       requiredConfidence,
		Sources:                  sources,
		ContinuingTransactionIDs: continuing,
		PrincipalPolicy:          normalizePrincipalPolicy(plan.PrincipalPolicy),
	}
}

func normalizePrincipalPolicy(policy types.FIPrincipalPolicy) types.FIPrincipalPolicy {
	switch policy {
	case types.PrincipalPreserveNominal:
		return types.PrincipalPreserveNominal
	case types.PrincipalPreserveReal:
		return types.PrincipalPreserveReal
	default:
		return types.PrincipalAllowDrawdown
	}
}

func asObject(config any) (map[string]any, bool) {
	obj, ok := config.(map[string]any)
	return obj, ok
}

func numberField(obj map[string]any, key string) (float64, bool) {
	value, ok := obj[key].(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func stringField(obj map[string]any, key string) (string, bool) {
	value, ok := obj[key].(string)
	if !ok {
		return "", false
	}
	return value, true
}

func stringArrayField(obj map[string]any, key string) ([]string, bool) {
	raw, ok := obj[key]
	if !ok {
		return nil, false
	}
	list, ok := raw.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		s, ok := item.(string)
		if !ok {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

// ValidateFIPlanConfig validates raw FI config JSON and returns the normalized
// plan.
func ValidateFIPlanConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	if _, present := obj["sources"]; !present {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	sourcesRaw, ok := obj["sources"].([]any)
	if !ok {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	for _, sourceRaw := range sourcesRaw {
		source, ok := sourceRaw.(map[string]any)
		if !ok {
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
		if _, ok := source["included"].(bool); !ok {
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
		switch source["type"] {
		case "cashflow":
			if _, ok := source["transactionId"].(string); !ok || len(source) > 3 {
				return fmt.Errorf("Financial independence configuration is invalid.")
			}
		case "asset":
			if _, ok := source["accountId"].(string); !ok {
				return fmt.Errorf("Financial independence configuration is invalid.")
			}
			if override, present := source["withdrawalRateOverride"]; present {
				num, okNum := override.(float64)
				if !okNum || math.IsNaN(num) || math.IsInf(num, 0) {
					return fmt.Errorf("Financial independence configuration is invalid.")
				}
			}
			if len(source) > 4 {
				return fmt.Errorf("Financial independence configuration is invalid.")
			}
		default:
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
	}
	if _, ok := stringArrayField(obj, "continuingTransactionIds"); !ok {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	policyValue, present := obj["principalPolicy"]
	if !present {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	policyString, ok := policyValue.(string)
	if !ok {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	switch policyString {
	case string(types.PrincipalAllowDrawdown), string(types.PrincipalPreserveNominal), string(types.PrincipalPreserveReal):
	default:
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	if basisRaw, present := obj["annualExpenseTargetBasis"]; present {
		basis, ok := basisRaw.(string)
		if !ok {
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
		switch basis {
		case string(types.ExpenseBasisProjectionStart), string(types.ExpenseBasisFIDateDollars):
		default:
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
	}
	numericKeys := []string{
		"minimumNetWorth",
		"annualExpenseTarget",
		"annualExpenseGrowthRate",
		"withdrawalRate",
		"evaluationYears",
		"requiredConfidence",
	}
	for _, key := range numericKeys {
		if _, ok := numberField(obj, key); !ok {
			return fmt.Errorf("Financial independence %s must be a finite number.", fiKeyLabel(key))
		}
	}
	return nil
}

func fiKeyLabel(key string) string { return key }

// ParseFIPlan converts validated JSON into a typed normalized plan.
func ParseFIPlan(config any) (types.FIPlan, error) {
	if err := ValidateFIPlanConfig(config); err != nil {
		return types.FIPlan{}, err
	}
	obj, ok := asObject(config)
	if !ok {
		return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
	}
	plan := types.FIPlan{}
	plan.MinimumNetWorth, _ = numberField(obj, "minimumNetWorth")
	plan.AnnualExpenseTarget, _ = numberField(obj, "annualExpenseTarget")
	plan.AnnualExpenseGrowthRate, _ = numberField(obj, "annualExpenseGrowthRate")
	plan.WithdrawalRate, _ = numberField(obj, "withdrawalRate")
	evaluationYears, _ := numberField(obj, "evaluationYears")
	plan.EvaluationYears = int(evaluationYears)
	plan.RequiredConfidence, _ = numberField(obj, "requiredConfidence")
	switch obj["principalPolicy"] {
	case string(types.PrincipalPreserveNominal):
		plan.PrincipalPolicy = types.PrincipalPreserveNominal
	case string(types.PrincipalPreserveReal):
		plan.PrincipalPolicy = types.PrincipalPreserveReal
	default:
		plan.PrincipalPolicy = types.PrincipalAllowDrawdown
	}
	if basisRaw, present := obj["annualExpenseTargetBasis"]; present {
		if basis, ok := basisRaw.(string); ok && basis == string(types.ExpenseBasisProjectionStart) {
			plan.AnnualExpenseTargetBasis = types.ExpenseBasisProjectionStart
		} else {
			plan.AnnualExpenseTargetBasis = types.ExpenseBasisFIDateDollars
		}
	} else {
		plan.AnnualExpenseTargetBasis = types.ExpenseBasisFIDateDollars
	}
	if sourcesRaw, ok := obj["sources"].([]any); ok {
		for _, sourceRaw := range sourcesRaw {
			source, ok := sourceRaw.(map[string]any)
			if !ok {
				return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
			}
			included, ok := source["included"].(bool)
			if !ok {
				return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
			}
			fiSource := types.FISource{Included: included}
			if source["type"] == "cashflow" {
				transactionID, ok := stringField(source, "transactionId")
				if !ok {
					return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
				}
				fiSource.Type = "cashflow"
				fiSource.TransactionID = transactionID
			} else {
				accountID, ok := stringField(source, "accountId")
				if !ok {
					return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
				}
				fiSource.Type = "asset"
				fiSource.AccountID = accountID
				if override, present := source["withdrawalRateOverride"]; present {
					num, ok := override.(float64)
					if !ok {
						return types.FIPlan{}, fmt.Errorf("Financial independence configuration is invalid.")
					}
					fiSource.WithdrawalRateOverride = &num
				}
			}
			plan.Sources = append(plan.Sources, fiSource)
		}
	}
	ids, _ := stringArrayField(obj, "continuingTransactionIds")
	plan.ContinuingTransactionIDs = ids
	return NormalizeFIPlan(plan), nil
}

// ValidateThresholdConfig validates net worth threshold config JSON.
func ValidateThresholdConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Net worth threshold target must be a finite number.")
	}
	target, ok := numberField(obj, "target")
	if !ok {
		return fmt.Errorf("Net worth threshold target must be a finite number.")
	}
	_ = target
	return nil
}

// ParseThresholdConfig converts validated JSON into a typed config.
func ParseThresholdConfig(config any) (types.NetWorthThresholdConfig, error) {
	var parsed types.NetWorthThresholdConfig
	if err := ValidateThresholdConfig(config); err != nil {
		return parsed, err
	}
	obj := config.(map[string]any)
	target, _ := numberField(obj, "target")
	parsed.Target = target
	return parsed, nil
}

// ValidateAccountBalanceConfig validates account balance config JSON. The
// account reference is checked against the model by the model validator;
// this validates the config's own shape.
func ValidateAccountBalanceConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Account balance target must be an object.")
	}
	accountID, ok := stringField(obj, "accountId")
	if !ok || accountID == "" {
		return fmt.Errorf("Account balance evaluation must name an account.")
	}
	if _, ok := numberField(obj, "target"); !ok {
		return fmt.Errorf("Account balance target must be a finite number.")
	}
	return nil
}

// ParseAccountBalanceConfig converts validated JSON into a typed config.
func ParseAccountBalanceConfig(config any) (types.AccountBalanceConfig, error) {
	var parsed types.AccountBalanceConfig
	if err := ValidateAccountBalanceConfig(config); err != nil {
		return parsed, err
	}
	obj := config.(map[string]any)
	accountID, _ := stringField(obj, "accountId")
	target, _ := numberField(obj, "target")
	parsed.AccountID = accountID
	parsed.Target = target
	return parsed, nil
}

// ValidateFulfillmentConfig validates transaction fulfillment config JSON.
func ValidateFulfillmentConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Transaction fulfillment configuration must be an object.")
	}
	raw, present := obj["transactionIds"]
	if !present || raw == nil {
		return nil
	}
	list, ok := raw.([]any)
	if !ok {
		return fmt.Errorf("Transaction fulfillment transactionIds must be null or an array of IDs.")
	}
	for _, item := range list {
		id, ok := item.(string)
		if !ok || strings.TrimSpace(id) == "" {
			return fmt.Errorf("Transaction fulfillment transactionIds must be null or an array of IDs.")
		}
	}
	return nil
}

// ParseFulfillmentConfig converts validated JSON into a typed config,
// de-duplicating IDs while preserving order.
func ParseFulfillmentConfig(config any) (types.TransactionFulfillmentConfig, error) {
	var parsed types.TransactionFulfillmentConfig
	if err := ValidateFulfillmentConfig(config); err != nil {
		return parsed, err
	}
	obj := config.(map[string]any)
	raw, present := obj["transactionIds"]
	if !present || raw == nil {
		return parsed, nil
	}
	seen := map[string]bool{}
	for _, item := range raw.([]any) {
		id := item.(string)
		if seen[id] {
			continue
		}
		seen[id] = true
		parsed.TransactionIDs = append(parsed.TransactionIDs, id)
	}
	return parsed, nil
}

// ValidateCycleFulfillmentConfig validates card cycle budget config JSON.
// The account references are checked against the model by the model
// validator; this validates the config's own shape.
func ValidateCycleFulfillmentConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Cycle fulfillment configuration must be an object.")
	}
	ids, ok := stringArrayField(obj, "accountIds")
	if !ok || len(ids) == 0 {
		return fmt.Errorf("Cycle fulfillment must list at least one account.")
	}
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return fmt.Errorf("Cycle fulfillment must list at least one account.")
		}
	}
	dayRaw, present := obj["statementDay"]
	if !present {
		return fmt.Errorf("Cycle fulfillment statementDay must be an integer between 1 and 28.")
	}
	day, ok := dayRaw.(float64)
	if !ok || math.IsNaN(day) || math.IsInf(day, 0) || day != math.Trunc(day) || day < 1 || day > 28 {
		return fmt.Errorf("Cycle fulfillment statementDay must be an integer between 1 and 28.")
	}
	budget, ok := numberField(obj, "budget")
	if !ok || budget < 0 {
		return fmt.Errorf("Cycle fulfillment budget must be a finite number at or above zero.")
	}
	return nil
}

// ParseCycleFulfillmentConfig converts validated JSON into a typed config,
// de-duplicating IDs while preserving order.
func ParseCycleFulfillmentConfig(config any) (types.CycleFulfillmentConfig, error) {
	var parsed types.CycleFulfillmentConfig
	if err := ValidateCycleFulfillmentConfig(config); err != nil {
		return parsed, err
	}
	obj := config.(map[string]any)
	ids, _ := stringArrayField(obj, "accountIds")
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		parsed.AccountIDs = append(parsed.AccountIDs, id)
	}
	day, _ := numberField(obj, "statementDay")
	budget, _ := numberField(obj, "budget")
	parsed.StatementDay = int(day)
	parsed.Budget = budget
	return parsed, nil
}
