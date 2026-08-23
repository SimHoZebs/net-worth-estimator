package domain

import (
	"fmt"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Income amount config parsing/validation ported from incomeConfig.ts and the
// payroll pipeline from incomeResolution.ts.

// IncomeResolutionError mirrors IncomeResolutionError.
type IncomeResolutionError struct{ Message string }

func (e *IncomeResolutionError) Error() string { return e.Message }

func incomeErrf(format string, args ...any) *IncomeResolutionError {
	return &IncomeResolutionError{Message: fmt.Sprintf(format, args...)}
}

// ParseIncomeAmountConfig validates shape; returns typed config or error.
func ParseIncomeAmountConfig(value map[string]types.JsonValue) (types.IncomeAmountConfig, error) {
	config := types.IncomeAmountConfig{}
	sourceID, ok := value["incomeSourceId"].(string)
	if !ok || trimSpace(sourceID) == "" {
		return config, incomeErrf("Invalid income config: incomeSourceId must be a non-empty string")
	}
	config.IncomeSourceID = sourceID
	resolversRaw, ok := value["resolvers"].([]any)
	if !ok {
		return config, incomeErrf("Invalid income config: resolvers must be an array")
	}
	for i, raw := range resolversRaw {
		stepMap, ok := raw.(map[string]any)
		if !ok {
			return config, incomeErrf("Invalid income config: resolver step %d must be an object", i+1)
		}
		step, err := parseResolverStep(stepMap)
		if err != nil {
			return config, err
		}
		config.Resolvers = append(config.Resolvers, step)
	}
	return config, nil
}

func parseResolverStep(stepMap map[string]any) (types.IncomeResolverStep, error) {
	var step types.IncomeResolverStep
	resolver, ok := stepMap["resolver"].(string)
	if !ok || trimSpace(resolver) == "" {
		return step, incomeErrf("Invalid income config: resolver must be a non-empty string")
	}
	step.Resolver = resolver
	if cfg, ok := stepMap["config"].(map[string]any); ok {
		step.Config = cfg
	} else {
		step.Config = map[string]any{}
	}
	switch dest := stepMap["destinationAccountId"].(type) {
	case nil:
		step.DestinationAccountID = nil
	case string:
		if trimSpace(dest) == "" {
			return step, incomeErrf("Invalid income config: destinationAccountId must be a non-empty string or null")
		}
		step.DestinationAccountID = &dest
	default:
		return step, incomeErrf("Invalid income config: destinationAccountId must be a string or null")
	}
	switch match := stepMap["employerMatchRate"].(type) {
	case nil:
	case float64:
		if math.IsNaN(match) || match < 0 || match > 1 {
			return step, incomeErrf("Invalid income config: employerMatchRate out of range")
		}
		step.EmployerMatchRate = &match
	case bool:
	default:
		if _, present := stepMap["employerMatchRate"]; present {
			return step, incomeErrf("Invalid income config: employerMatchRate must be a number in [0,1]")
		}
	}
	return step, nil
}

func validatePercentageStep(config map[string]types.JsonValue, label string) error {
	rateRaw, ok := config["rate"]
	if !ok {
		return incomeErrf("%s: rate required", label)
	}
	rate, ok := rateRaw.(float64)
	if !ok || math.IsNaN(rate) || rate < 0 || rate > 1 {
		return incomeErrf("%s: rate must be a number in [0,1]", label)
	}
	if capRaw, present := config["annualCap"]; present {
		switch capValue := capRaw.(type) {
		case nil:
		case float64:
			if math.IsNaN(capValue) || capValue < 0 {
				return incomeErrf("%s: annualCap must be non-negative or null", label)
			}
		default:
			return incomeErrf("%s: annualCap must be a number or null", label)
		}
	}
	return nil
}

func validateTaxStep(config map[string]types.JsonValue, label string) (string, error) {
	profileID, ok := config["profileId"].(string)
	if !ok || trimSpace(profileID) == "" {
		return "", incomeErrf("%s: profileId must be a non-empty string", label)
	}
	return profileID, nil
}

// ValidateIncomeAmountConfig parses plus cross-validates references.
func ValidateIncomeAmountConfig(value map[string]types.JsonValue, references *AmountReferenceContext) error {
	config, err := ParseIncomeAmountConfig(value)
	if err != nil {
		return err
	}
	if references != nil && references.IncomeSourceIDs != nil &&
		!references.IncomeSourceIDs[config.IncomeSourceID] {
		return incomeErrf("Income source '%s' does not exist.", config.IncomeSourceID)
	}
	for index, step := range config.Resolvers {
		label := fmt.Sprintf("Invalid income step %d", index+1)
		if step.DestinationAccountID != nil && references != nil &&
			!references.AccountIDs[*step.DestinationAccountID] {
			return incomeErrf("Income step %d destination account '%s' does not exist.",
				index+1, *step.DestinationAccountID)
		}
		if step.EmployerMatchRate != nil && step.DestinationAccountID == nil {
			return incomeErrf("Income step %d employer match requires a destination account.", index+1)
		}
		switch step.Resolver {
		case "percentage":
			if err := validatePercentageStep(step.Config, label); err != nil {
				return err
			}
		case "progressive-bracket":
			profileID, err := validateTaxStep(step.Config, label)
			if err != nil {
				return err
			}
			if references != nil && references.TaxProfileIDs != nil &&
				!references.TaxProfileIDs[profileID] {
				return incomeErrf("Tax profile '%s' does not exist.", profileID)
			}
		default:
			return incomeErrf("Unknown income resolver '%s' at step %d.", step.Resolver, index+1)
		}
	}
	return nil
}

// ProgressiveIncomeLiability computes progressive tax over profile brackets.
func ProgressiveIncomeLiability(taxableAmount float64, profile *types.IncomeTaxProfile) float64 {
	previousLimit := 0.0
	liability := 0.0
	for _, bracket := range profile.Brackets {
		upper := taxableAmount
		if bracket.UpTo != nil {
			upper = *bracket.UpTo
		}
		width := math.Max(0, math.Min(taxableAmount, upper)-previousLimit)
		liability += width * bracket.Rate
		if taxableAmount <= upper {
			break
		}
		previousLimit = upper
	}
	return liability
}

func findIncomeSource(data *types.IncomeDataSnapshot, id, date string) (*types.IncomeSourceDefinition, error) {
	var matches []*types.IncomeSourceDefinition
	for i := range data.IncomeSources {
		source := &data.IncomeSources[i]
		if source.ID != id {
			continue
		}
		if source.EffectiveFrom <= date && (source.EffectiveTo == nil || date <= *source.EffectiveTo) {
			matches = append(matches, source)
		}
	}
	if len(matches) != 1 {
		if len(matches) == 0 {
			return nil, incomeErrf("No income source '%s' is effective on %s.", id, date)
		}
		return nil, incomeErrf("More than one income source '%s' is effective on %s.", id, date)
	}
	return matches[0], nil
}

func findTaxProfile(data *types.IncomeDataSnapshot, id string) (*types.IncomeTaxProfile, error) {
	for i := range data.TaxProfiles {
		if data.TaxProfiles[i].ID == id {
			return &data.TaxProfiles[i], nil
		}
	}
	return nil, incomeErrf("Tax profile '%s' does not exist.", id)
}

// AccountDeltaEntry is one account balance change.
type AccountDeltaEntry struct {
	AccountID string
	Delta     float64
}

func applyIncomeMovement(destinations []string, requestedAmount float64, balances map[string]float64, accountByID map[string]types.Account, order []string) (AccountMovementResult, []AccountDeltaEntry) {
	before := make(map[string]float64, len(balances))
	for id, balance := range balances {
		before[id] = balance
	}
	result := ResolveAccountMovement(AccountMovementAction{
		SourceAccountID: nil,
		Destinations:    destinations,
		RequestedAmount: requestedAmount,
	}, balances, accountByID)
	ApplyAccountMovement(AccountMovementAction{
		SourceAccountID: nil,
		Destinations:    destinations,
		RequestedAmount: result.RealizedAmount,
	}, result.RealizedAmount, balances, accountByID)
	deltas := collectDeltasInOrder(before, balances, order)
	return result, deltas
}

func collectDeltas(before, after map[string]float64) []AccountDeltaEntry {
	return collectDeltasInOrder(before, after, nil)
}

// collectDeltasInOrder emits changed accounts in model declaration order
// (matching TS object insertion order), with any extras appended sorted.
func collectDeltasInOrder(before, after map[string]float64, order []string) []AccountDeltaEntry {
	seen := map[string]bool{}
	deltas := []AccountDeltaEntry{}
	emit := func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		was := before[id]
		delta := after[id] - was
		if delta != 0 {
			deltas = append(deltas, AccountDeltaEntry{AccountID: id, Delta: delta})
		}
	}
	for _, id := range order {
		if _, ok := after[id]; ok {
			emit(id)
		}
	}
	extraIDs := make([]string, 0, len(after))
	for id := range after {
		if !seen[id] {
			extraIDs = append(extraIDs, id)
		}
	}
	sortStrings(extraIDs)
	for _, id := range extraIDs {
		emit(id)
	}
	return deltas
}

// IncomeExecutionResult is the outcome of executing an income posting.
type IncomeExecutionResult struct {
	RequestedAmount float64
	RealizedAmount  float64
	AccountDeltas   []AccountDeltaEntry
	Income          types.IncomeEvent
}

// ExecuteIncomePosting runs the ordered payroll pipeline for one occurrence.
func ExecuteIncomePosting(posting *types.Posting, date string, data *types.IncomeDataSnapshot, balances map[string]float64, accountByID map[string]types.Account, order []string) (IncomeExecutionResult, error) {
	result := IncomeExecutionResult{}
	config, err := ParseIncomeAmountConfig(posting.Amount.Config)
	if err != nil {
		return result, err
	}
	incomeSourceIDs := make(map[string]bool, len(data.IncomeSources))
	for _, source := range data.IncomeSources {
		incomeSourceIDs[source.ID] = true
	}
	taxProfileIDs := make(map[string]bool, len(data.TaxProfiles))
	for _, profile := range data.TaxProfiles {
		taxProfileIDs[profile.ID] = true
	}
	accountIDs := make(map[string]bool, len(accountByID))
	for id := range accountByID {
		accountIDs[id] = true
	}
	if err := ValidateIncomeAmountConfig(posting.Amount.Config, &AmountReferenceContext{
		AccountIDs:      accountIDs,
		IncomeSourceIDs: incomeSourceIDs,
		TaxProfileIDs:   taxProfileIDs,
	}); err != nil {
		return result, err
	}
	source, err := findIncomeSource(data, config.IncomeSourceID, date)
	if err != nil {
		return result, err
	}
	divisor := FrequencyDivisor(posting.Frequency)
	grossAmount := source.AnnualGrossIncome / float64(divisor)
	annualRemaining := source.AnnualGrossIncome
	resolvers := []types.IncomeResolverEvent{}
	allDeltas := []AccountDeltaEntry{}
	employerMatchRequested := 0.0
	employerMatchRealized := 0.0

	for _, step := range config.Resolvers {
		beforeStep := annualRemaining
		requestedAnnual := 0.0
		if step.Resolver == "percentage" {
			rate, _ := step.Config["rate"].(float64)
			requestedAnnual = beforeStep * rate
			if capValue, ok := step.Config["annualCap"]; ok && capValue != nil {
				capFloat, _ := capValue.(float64)
				requestedAnnual = math.Min(requestedAnnual, capFloat)
			}
		} else {
			profileID, _ := step.Config["profileId"].(string)
			profile, err := findTaxProfile(data, profileID)
			if err != nil {
				return result, err
			}
			requestedAnnual = ProgressiveIncomeLiability(math.Max(0, beforeStep-profile.Deduction), profile)
		}
		requestedAmount := math.Max(0, requestedAnnual/float64(divisor))
		realizedAmount := requestedAmount
		if step.DestinationAccountID != nil {
			movement, deltas := applyIncomeMovement([]string{*step.DestinationAccountID}, requestedAmount, balances, accountByID, order)
			realizedAmount = movement.RealizedAmount
			allDeltas = append(allDeltas, deltas...)
		}
		annualRemaining = math.Max(0, beforeStep-realizedAmount*float64(divisor))
		employerMatchAmount := 0.0
		employerMatchRealizedAmount := 0.0
		if step.EmployerMatchRate != nil {
			employerMatchAmount = realizedAmount * *step.EmployerMatchRate
			employerMatchRequested += employerMatchAmount
			matchMovement, matchDeltas := applyIncomeMovement([]string{*step.DestinationAccountID}, employerMatchAmount, balances, accountByID, order)
			employerMatchRealized += matchMovement.RealizedAmount
			employerMatchRealizedAmount = matchMovement.RealizedAmount
			allDeltas = append(allDeltas, matchDeltas...)
		}
		resolvers = append(resolvers, types.IncomeResolverEvent{
			Resolver:                    step.Resolver,
			RequestedAmount:             requestedAmount,
			RealizedAmount:              realizedAmount,
			DestinationAccountID:        step.DestinationAccountID,
			TaxableAmountAfter:          annualRemaining,
			EmployerMatchAmount:         employerMatchAmount,
			EmployerMatchRealizedAmount: employerMatchRealizedAmount,
		})
	}

	netCashRequested := math.Max(0, annualRemaining/float64(divisor))
	destinations := posting.Destinations
	if destinations == nil {
		destinations = []string{}
	}
	netMovement, netDeltas := applyIncomeMovement(destinations, netCashRequested, balances, accountByID, order)
	allDeltas = append(allDeltas, netDeltas...)

	merged := map[string]float64{}
	for _, delta := range allDeltas {
		merged[delta.AccountID] += delta.Delta
	}
	accountDeltas := []AccountDeltaEntry{}
	ids := make([]string, 0, len(merged))
	for id := range merged {
		ids = append(ids, id)
	}
	sortStrings(ids)
	for _, id := range ids {
		if merged[id] != 0 {
			accountDeltas = append(accountDeltas, AccountDeltaEntry{AccountID: id, Delta: merged[id]})
		}
	}
	result.RequestedAmount = netCashRequested
	result.RealizedAmount = netMovement.RealizedAmount
	result.AccountDeltas = accountDeltas
	result.Income = types.IncomeEvent{
		AnnualGrossIncome:      source.AnnualGrossIncome,
		GrossAmount:            grossAmount,
		Resolvers:              resolvers,
		NetCashRequested:       netCashRequested,
		NetCashRealized:        netMovement.RealizedAmount,
		EmployerMatchRequested: employerMatchRequested,
		EmployerMatchRealized:  employerMatchRealized,
	}
	return result, nil
}

func trimSpace(value string) string {
	start, end := 0, len(value)
	for start < end && (value[start] == ' ' || value[start] == '\t') {
		start++
	}
	for end > start && (value[end-1] == ' ' || value[end-1] == '\t') {
		end--
	}
	return value[start:end]
}
