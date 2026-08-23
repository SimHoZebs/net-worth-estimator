package domain

import (
	"fmt"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Evaluation configuration validation/normalization ported from the three
// evaluator modules. Kept beside validation so document cross-validation and
// evaluation runtimes share one source of truth.

func finiteNonNegative(value, fallback float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	return math.Max(0, value)
}

// NormalizeFIPlan mirrors normalizeFinancialIndependencePlan.
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
			spendableIncomeIDs[source.PostingID] = true
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
	for _, id := range plan.ContinuingPostingIDs {
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
		ContinuingPostingIDs:     continuing,
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
// plan. Port of validateFinancialIndependencePlan.
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
		included, ok := source["included"].(bool)
		if !ok {
			return fmt.Errorf("Financial independence configuration is invalid.")
		}
		_ = included
		switch source["type"] {
		case "cashflow":
			postingID, ok := source["postingId"].(string)
			if !ok || len(source) > 3 {
				return fmt.Errorf("Financial independence configuration is invalid.")
			}
			_ = postingID
		case "asset":
			accountID, ok := source["accountId"].(string)
			if !ok {
				return fmt.Errorf("Financial independence configuration is invalid.")
			}
			_ = accountID
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
	if _, ok := stringArrayField(obj, "continuingPostingIds"); !ok {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	policyValue, present := obj["principalPolicy"]
	validPolicies := map[string]bool{
		string(types.PrincipalAllowDrawdown):   true,
		string(types.PrincipalPreserveNominal): true,
		string(types.PrincipalPreserveReal):    true,
	}
	policyString, ok := policyValue.(string)
	if !present || !ok || !validPolicies[policyString] {
		return fmt.Errorf("Financial independence configuration is invalid.")
	}
	if basisRaw, present := obj["annualExpenseTargetBasis"]; present {
		basis, ok := basisRaw.(string)
		validBases := map[string]bool{
			string(types.ExpenseBasisProjectionStart): true,
			string(types.ExpenseBasisFIDateDollars):   true,
		}
		if !ok || !validBases[basis] {
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
	obj := config.(map[string]any)
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
			source := sourceRaw.(map[string]any)
			fiSource := types.FISource{Included: source["included"].(bool)}
			if source["type"] == "cashflow" {
				fiSource.Type = "cashflow"
				fiSource.PostingID = source["postingId"].(string)
			} else {
				fiSource.Type = "asset"
				fiSource.AccountID = source["accountId"].(string)
				if override, present := source["withdrawalRateOverride"]; present {
					num := override.(float64)
					fiSource.WithdrawalRateOverride = &num
				}
			}
			plan.Sources = append(plan.Sources, fiSource)
		}
	}
	ids, _ := stringArrayField(obj, "continuingPostingIds")
	plan.ContinuingPostingIDs = ids
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

// ValidateFulfillmentConfig validates posting fulfillment config JSON.
func ValidateFulfillmentConfig(config any) error {
	obj, ok := asObject(config)
	if !ok {
		return fmt.Errorf("Posting fulfillment configuration must be an object.")
	}
	raw, present := obj["postingIds"]
	if !present || raw == nil {
		return nil
	}
	list, ok := raw.([]any)
	if !ok {
		return fmt.Errorf("Posting fulfillment postingIds must be null or an array of IDs.")
	}
	for _, item := range list {
		id, ok := item.(string)
		if !ok || trimSpace(id) == "" {
			return fmt.Errorf("Posting fulfillment postingIds must be null or an array of IDs.")
		}
	}
	return nil
}

// ParseFulfillmentConfig converts validated JSON into a typed config,
// de-duplicating IDs while preserving order.
func ParseFulfillmentConfig(config any) (types.PostingFulfillmentConfig, error) {
	var parsed types.PostingFulfillmentConfig
	if err := ValidateFulfillmentConfig(config); err != nil {
		return parsed, err
	}
	obj := config.(map[string]any)
	raw, present := obj["postingIds"]
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
		parsed.PostingIDs = append(parsed.PostingIDs, id)
	}
	return parsed, nil
}
