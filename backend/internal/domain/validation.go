package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Financial-model cross-validation.

func addIssue(issues *[]types.ModelValidationIssue, severity types.ValidationSeverity, code, message string, path ...any) {
	*issues = append(*issues, types.ModelValidationIssue{
		Severity: severity,
		Code:     code,
		Message:  message,
		Path:     path,
	})
}

func validateUniqueIDs(issues *[]types.ModelValidationIssue, ids []string, codePrefix string, path func(index int, field string) []any) {
	firstSeen := map[string]int{}
	for index, id := range ids {
		if firstRow, ok := firstSeen[id]; ok {
			addIssue(issues, types.SeverityError, fmt.Sprintf("%s.duplicate", codePrefix),
				fmt.Sprintf("ID '%s' is duplicated. First seen on row %d.", id, firstRow), path(index, "id")...)
			continue
		}
		firstSeen[id] = index + 2
	}
}

// ValidateFinancialModel runs all cross-field checks and returns issues in
// stable validation order.
func ValidateFinancialModel(document *types.FinancialModelDocument, incomeData *types.IncomeDataSnapshot) []types.ModelValidationIssue {
	issues := []types.ModelValidationIssue{}
	accountIDs := make(map[string]bool, len(document.Accounts))
	for _, account := range document.Accounts {
		accountIDs[account.ID] = true
	}

	accountIDList := make([]string, len(document.Accounts))
	for i, account := range document.Accounts {
		accountIDList[i] = account.ID
	}
	validateUniqueIDs(&issues, accountIDList, "account.id", func(index int, field string) []any {
		return pathWithField([]any{"accounts", index}, field)
	})
	postingIDList := make([]string, len(document.Postings))
	for i, posting := range document.Postings {
		postingIDList[i] = posting.ID
	}
	validateUniqueIDs(&issues, postingIDList, "posting.id", func(index int, field string) []any {
		return pathWithField([]any{"postings", index}, field)
	})
	ruleIDList := make([]string, len(document.RecurrenceRules))
	for i, rule := range document.RecurrenceRules {
		ruleIDList[i] = rule.ID
	}
	validateUniqueIDs(&issues, ruleIDList, "rule.id", func(index int, field string) []any {
		return pathWithField([]any{"recurrenceRules", index}, field)
	})
	validateEvaluationInstanceIDs(&issues, document)

	// Movement identity checks: posting and rule IDs share one namespace
	// with account IDs.
	movementIDs := make(map[string]bool, len(document.Postings)+len(document.RecurrenceRules))
	for _, posting := range document.Postings {
		movementIDs[posting.ID] = true
	}
	for index, rule := range document.RecurrenceRules {
		if movementIDs[rule.ID] {
			addIssue(&issues, types.SeverityError, "rule.id.collision",
				fmt.Sprintf("Rule ID '%s' collides with a posting ID. Posting and rule IDs share one namespace.", rule.ID),
				pathWithField([]any{"recurrenceRules", index}, "id")...)
		}
		movementIDs[rule.ID] = true
	}

	// Account identity checks.
	for index, account := range document.Accounts {
		if movementIDs[account.ID] {
			addIssue(&issues, types.SeverityError, "account.id.collision",
				fmt.Sprintf("Account ID '%s' collides with a posting or rule ID. IDs must be unique across accounts, postings, and rules.", account.ID),
				pathWithField([]any{"accounts", index}, "id")...)
		}
		if account.Enabled && account.Color == nil {
			addIssue(&issues, types.SeverityWarning, "account.color.missing",
				fmt.Sprintf("Enabled account '%s' has no chart color. Charts will use a neutral fallback until a color is provided.", account.ID),
				pathWithField([]any{"accounts", index}, "color")...)
		}
		if !account.Kind.Valid() {
			addIssue(&issues, types.SeverityError, "account.kind.unknown",
				fmt.Sprintf("Account '%s' has kind '%s'. Expected one of %s.", account.ID, account.Kind, joinAccountKinds()),
				pathWithField([]any{"accounts", index}, "kind")...)
		}
	}

	checkpointKeys := map[string]bool{}
	for index, checkpoint := range document.Checkpoints {
		if !accountIDs[checkpoint.AccountID] {
			addIssue(&issues, types.SeverityError, "checkpoint.account.missing",
				fmt.Sprintf("Checkpoint account '%s' does not exist.", checkpoint.AccountID),
				pathWithField([]any{"checkpoints", index}, "AccountId")...)
		}
		if !IsValidIsoDate(checkpoint.Date) {
			addIssue(&issues, types.SeverityError, "checkpoint.date.format",
				fmt.Sprintf("Checkpoint date '%s' must be a YYYY-MM-DD calendar date.", checkpoint.Date),
				pathWithField([]any{"checkpoints", index}, "date")...)
		}
		key := checkpoint.AccountID + "\x00" + checkpoint.Date
		if checkpointKeys[key] {
			addIssue(&issues, types.SeverityError, "checkpoint.account-date.duplicate",
				fmt.Sprintf("Account '%s' has more than one checkpoint on %s.", checkpoint.AccountID, checkpoint.Date),
				[]any{"checkpoints", index}...)
		}
		checkpointKeys[key] = true
	}

	dependencies := validateMovementAmounts(&issues, document, accountIDs, incomeData)
	validatePostingDependencies(&issues, document, dependencies)
	validatePostingRoutes(&issues, document.Postings, accountIDs)
	validateRuleSchedules(&issues, document, accountIDs)
	validatePostingClaims(&issues, document)
	validateAccountBounds(&issues, document.Accounts)
	validateEvaluationConfigs(&issues, document)
	validateEvaluationAccountReferences(&issues, document, accountIDs)
	validatePaymentTerms(&issues, document, accountIDs)
	validatePaymentTermsCoverage(&issues, document)

	return issues
}

func pathWithField(path []any, field string) []any {
	out := make([]any, 0, len(path)+1)
	out = append(out, path...)
	return append(out, field)
}

func validateEvaluationInstanceIDs(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument) {
	seen := map[string]bool{}
	for _, evaluationType := range types.EvaluationTypeOrder {
		for _, instance := range evaluationInstances(document, evaluationType) {
			if seen[instance.InstanceID] {
				addIssue(issues, types.SeverityError, "evaluation.instanceId.duplicate",
					fmt.Sprintf("ID '%s' is duplicated across behavior configuration files.", instance.InstanceID),
					[]any{"evaluations", evaluationType}...)
				continue
			}
			seen[instance.InstanceID] = true
		}
	}
}

type instanceRef struct {
	Type       string
	InstanceID string
	Enabled    bool
	Config     any
}

func evaluationInstances(document *types.FinancialModelDocument, evaluationType string) []instanceRef {
	refs := []instanceRef{}
	switch evaluationType {
	case types.EvaluationTypeFinancialIndependence:
		for _, item := range document.Evaluations.FinancialIndependence {
			refs = append(refs, instanceRef{evaluationType, item.InstanceID, item.Enabled, item.Config})
		}
	case types.EvaluationTypeNetWorthThreshold:
		for _, item := range document.Evaluations.NetWorthThreshold {
			refs = append(refs, instanceRef{evaluationType, item.InstanceID, item.Enabled, item.Config})
		}
	case types.EvaluationTypeAccountBalance:
		for _, item := range document.Evaluations.AccountBalance {
			refs = append(refs, instanceRef{evaluationType, item.InstanceID, item.Enabled, item.Config})
		}
	case types.EvaluationTypePostingFulfillment:
		for _, item := range document.Evaluations.PostingFulfillment {
			refs = append(refs, instanceRef{evaluationType, item.InstanceID, item.Enabled, item.Config})
		}
	case types.EvaluationTypeCycleFulfillment:
		for _, item := range document.Evaluations.CycleFulfillment {
			refs = append(refs, instanceRef{evaluationType, item.InstanceID, item.Enabled, item.Config})
		}
	}
	return refs
}

func validateEvaluationConfigs(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument) {
	for _, evaluationType := range types.EvaluationTypeOrder {
		for index, instance := range evaluationInstances(document, evaluationType) {
			var err error
			switch evaluationType {
			case types.EvaluationTypeFinancialIndependence:
				err = ValidateFIPlanConfig(instance.Config)
			case types.EvaluationTypeNetWorthThreshold:
				err = ValidateThresholdConfig(instance.Config)
			case types.EvaluationTypeAccountBalance:
				err = ValidateAccountBalanceConfig(instance.Config)
			case types.EvaluationTypePostingFulfillment:
				err = ValidateFulfillmentConfig(instance.Config)
			case types.EvaluationTypeCycleFulfillment:
				err = ValidateCycleFulfillmentConfig(instance.Config)
			}
			if err != nil {
				path := []any{"evaluations", evaluationType, index}
				addIssue(issues, types.SeverityError, "evaluation.config.invalid", err.Error(), path...)
			}
		}
	}
}

// validateEvaluationAccountReferences checks that an account balance evaluation names
// an account the document actually contains. A dangling reference would
// otherwise evaluate as never reached with no diagnostic.
func validateEvaluationAccountReferences(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, accountIDs map[string]bool) {
	for index, item := range document.Evaluations.AccountBalance {
		parsed, err := ParseAccountBalanceConfig(item.Config)
		if err != nil {
			continue // reported by validateEvaluationConfigs
		}
		if !accountIDs[parsed.AccountID] {
			addIssue(issues, types.SeverityError, "evaluation.accountBalance.accountId.invalid",
				fmt.Sprintf("Account balance evaluation '%s' references account '%s', which does not exist.", item.InstanceID, parsed.AccountID),
				"evaluations", types.EvaluationTypeAccountBalance, index, "config", "accountId")
		}
	}
	for index, item := range document.Evaluations.CycleFulfillment {
		parsed, err := ParseCycleFulfillmentConfig(item.Config)
		if err != nil {
			continue // reported by validateEvaluationConfigs
		}
		for _, accountID := range parsed.AccountIDs {
			if !accountIDs[accountID] {
				addIssue(issues, types.SeverityError, "evaluation.cycleFulfillment.accountId.invalid",
					fmt.Sprintf("Cycle fulfillment evaluation '%s' references account '%s', which does not exist.", item.InstanceID, accountID),
					"evaluations", types.EvaluationTypeCycleFulfillment, index, "config", "accountIds")
			}
		}
	}
}

// validateMovementAmounts validates amount descriptors for manual postings
// and rule templates together. References may name posting or rule IDs, so
// the dependency graph spans both.
func validateMovementAmounts(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, accountIDs map[string]bool, incomeData *types.IncomeDataSnapshot) map[string][]string {
	movementIDsSet := MovementIDs(document)
	var incomeSourceIDs, taxProfileIDs map[string]bool
	if incomeData != nil {
		incomeSourceIDs = make(map[string]bool, len(incomeData.IncomeSources))
		for _, source := range incomeData.IncomeSources {
			incomeSourceIDs[source.ID] = true
		}
		taxProfileIDs = make(map[string]bool, len(incomeData.TaxProfiles))
		for _, profile := range incomeData.TaxProfiles {
			taxProfileIDs[profile.ID] = true
		}
	}
	dependencies := map[string][]string{}
	validateAmount := func(id string, amount types.PostingAmountResolution, path []any) {
		deps, err := ValidateAmountDescriptor(amount, &AmountReferenceContext{
			AccountIDs:      accountIDs,
			PostingIDs:      movementIDsSet,
			IncomeSourceIDs: incomeSourceIDs,
			TaxProfileIDs:   taxProfileIDs,
		})
		if err != nil {
			message := err.Error()
			if resErr, ok := err.(*AmountResolutionError); ok {
				message = resErr.Message
			} else if evalErr, ok := err.(*EvalError); ok {
				message = evalErr.Message
			} else if parseErr, ok := err.(*ParseError); ok {
				message = parseErr.Error()
			}
			addIssue(issues, types.SeverityError, "posting.amount.invalid", message,
				pathWithField(path, "amount")...)
			return
		}
		dependencies[id] = deps
	}
	for index := range document.Postings {
		posting := &document.Postings[index]
		validateAmount(posting.ID, posting.Amount, []any{"postings", index})
	}
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		validateAmount(rule.ID, rule.Amount, []any{"recurrenceRules", index})
		if rule.Amount.Resolver != "expression" &&
			(rule.AnnualRate != 0 || rule.AnnualGrowthRate != 0 || rule.Volatility != 0) {
			addIssue(issues, types.SeverityError, "posting.amount.non_expression_rates",
				"Non-expression amount resolvers require annualRate, annualGrowthRate, and volatility to be zero.",
				pathWithField([]any{"recurrenceRules", index}, "amount")...)
		}
	}
	return dependencies
}

func validatePostingDependencies(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, dependencies map[string][]string) {
	visiting := map[string]bool{}
	visited := map[string]bool{}
	cyclic := map[string]bool{}

	var visit func(id string) bool
	visit = func(id string) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return cyclic[id]
		}
		visiting[id] = true
		hasCycle := false
		for _, dependency := range dependencies[id] {
			if dependency == id || visit(dependency) {
				hasCycle = true
			}
		}
		delete(visiting, id)
		visited[id] = true
		if hasCycle {
			cyclic[id] = true
		}
		return hasCycle
	}

	for index := range document.Postings {
		posting := &document.Postings[index]
		if !visit(posting.ID) {
			continue
		}
		addIssue(issues, types.SeverityError, "posting.amount.circular",
			fmt.Sprintf("Amount resolution for '%s' creates a circular posting dependency.", posting.ID),
			pathWithField([]any{"postings", index}, "amount")...)
	}
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		if !visit(rule.ID) {
			continue
		}
		addIssue(issues, types.SeverityError, "posting.amount.circular",
			fmt.Sprintf("Amount resolution for '%s' creates a circular posting dependency.", rule.ID),
			pathWithField([]any{"recurrenceRules", index}, "amount")...)
	}
}

func validatePostingRoutes(issues *[]types.ModelValidationIssue, postings []types.Posting, accountIDs map[string]bool) {
	for index := range postings {
		posting := &postings[index]
		if posting.Amount.Resolver == "income" {
			if posting.SourceAccountID != nil {
				addIssue(issues, types.SeverityError, "posting.income.source.invalid",
					"Income postings cannot withdraw from an account.",
					pathWithField([]any{"postings", index}, "sourceAccountId")...)
			}
		}
		if posting.SourceAccountID != nil && !accountIDs[*posting.SourceAccountID] {
			addIssue(issues, types.SeverityError, "posting.source.missing",
				fmt.Sprintf("Posting source account '%s' does not exist.", *posting.SourceAccountID),
				pathWithField([]any{"postings", index}, "sourceAccountId")...)
		}
		if posting.Destinations != nil {
			seen := map[string]bool{}
			for _, destinationID := range posting.Destinations {
				if !accountIDs[destinationID] {
					addIssue(issues, types.SeverityError, "posting.destination.missing",
						fmt.Sprintf("Posting destination account '%s' does not exist.", destinationID),
						pathWithField([]any{"postings", index}, "destinations")...)
				}
				if seen[destinationID] {
					addIssue(issues, types.SeverityError, "posting.destinations.duplicate",
						fmt.Sprintf("Destination account '%s' appears more than once.", destinationID),
						pathWithField([]any{"postings", index}, "destinations")...)
				}
				seen[destinationID] = true
			}
		}
		if posting.SourceAccountID == nil && len(posting.Destinations) == 0 {
			addIssue(issues, types.SeverityError, "posting.accounts.empty",
				"Postings must set sourceAccountId, destinations, or both.",
				[]any{"postings", index}...)
		}
		if posting.SourceAccountID != nil && containsString(posting.Destinations, *posting.SourceAccountID) {
			addIssue(issues, types.SeverityError, "posting.accounts.same",
				"Posting sourceAccountId must not appear in destinations.",
				[]any{"postings", index}...)
		}
		if !IsValidIsoDate(posting.Date) {
			addIssue(issues, types.SeverityError, "posting.date.format",
				fmt.Sprintf("Posting '%s' date must be a YYYY-MM-DD calendar date.", posting.ID),
				pathWithField([]any{"postings", index}, "date")...)
		}
	}
}

// validateRuleSchedules checks rule routes, frequencies, and schedule bounds.
func validateRuleSchedules(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument, accountIDs map[string]bool) {
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		base := []any{"recurrenceRules", index}
		if rule.Amount.Resolver == "income" {
			if rule.SourceAccountID != nil {
				addIssue(issues, types.SeverityError, "posting.income.source.invalid",
					"Income rules cannot withdraw from an account.",
					pathWithField(base, "sourceAccountId")...)
			}
		}
		if rule.SourceAccountID != nil && !accountIDs[*rule.SourceAccountID] {
			addIssue(issues, types.SeverityError, "posting.source.missing",
				fmt.Sprintf("Rule source account '%s' does not exist.", *rule.SourceAccountID),
				pathWithField(base, "sourceAccountId")...)
		}
		if rule.Destinations != nil {
			seen := map[string]bool{}
			for _, destinationID := range rule.Destinations {
				if !accountIDs[destinationID] {
					addIssue(issues, types.SeverityError, "posting.destination.missing",
						fmt.Sprintf("Rule destination account '%s' does not exist.", destinationID),
						pathWithField(base, "destinations")...)
				}
				if seen[destinationID] {
					addIssue(issues, types.SeverityError, "posting.destinations.duplicate",
						fmt.Sprintf("Destination account '%s' appears more than once.", destinationID),
						pathWithField(base, "destinations")...)
				}
				seen[destinationID] = true
			}
		}
		if rule.SourceAccountID == nil && len(rule.Destinations) == 0 {
			addIssue(issues, types.SeverityError, "posting.accounts.empty",
				"Rules must set sourceAccountId, destinations, or both.",
				base...)
		}
		if rule.SourceAccountID != nil && containsString(rule.Destinations, *rule.SourceAccountID) {
			addIssue(issues, types.SeverityError, "posting.accounts.same",
				"Rule sourceAccountId must not appear in destinations.",
				base...)
		}
		switch rule.Frequency {
		case types.FrequencyDaily, types.FrequencyWeekly, types.FrequencyMonthly, types.FrequencyQuarterly, types.FrequencyAnnual:
		default:
			addIssue(issues, types.SeverityError, "rule.frequency.invalid",
				fmt.Sprintf("Rule '%s' has frequency '%s'. Expected daily, weekly, monthly, quarterly, or annual.", rule.ID, rule.Frequency),
				pathWithField(base, "frequency")...)
		}
		if !IsValidIsoDate(rule.StartDate) {
			addIssue(issues, types.SeverityError, "rule.start-date.format",
				fmt.Sprintf("Rule '%s' startDate must be a YYYY-MM-DD calendar date.", rule.ID),
				pathWithField(base, "startDate")...)
		}
		if rule.EndDate != nil && !IsValidIsoDate(*rule.EndDate) {
			addIssue(issues, types.SeverityError, "rule.end-date.format",
				fmt.Sprintf("Rule '%s' endDate must be a YYYY-MM-DD calendar date.", rule.ID),
				pathWithField(base, "endDate")...)
		}
		if rule.EndDate != nil &&
			IsValidIsoDate(rule.StartDate) &&
			IsValidIsoDate(*rule.EndDate) &&
			CompareIsoDates(*rule.EndDate, rule.StartDate) < 0 {
			addIssue(issues, types.SeverityError, "rule.schedule.invalid",
				"Rule endDate must be the same as or later than startDate.",
				pathWithField(base, "endDate")...)
		}
	}
}

// validatePostingClaims checks that each claim names a real scheduled
// occurrence of its rule, and that no occurrence is claimed twice. Claims
// are manual: validation only verifies the named occurrence exists.
func validatePostingClaims(issues *[]types.ModelValidationIssue, document *types.FinancialModelDocument) {
	rulesByID := make(map[string]*types.RecurrenceRule, len(document.RecurrenceRules))
	for index := range document.RecurrenceRules {
		rule := &document.RecurrenceRules[index]
		rulesByID[rule.ID] = rule
	}
	claimed := map[string]bool{}
	for index := range document.Postings {
		posting := &document.Postings[index]
		if posting.Claim == nil {
			continue
		}
		base := []any{"postings", index, "claim"}
		claim := posting.Claim
		rule, ok := rulesByID[claim.RuleID]
		if !ok {
			addIssue(issues, types.SeverityError, "posting.claim.rule.missing",
				fmt.Sprintf("Posting '%s' claims rule '%s', which does not exist.", posting.ID, claim.RuleID),
				append(base, "ruleId")...)
			continue
		}
		if !IsValidIsoDate(claim.OccurrenceDate) {
			addIssue(issues, types.SeverityError, "posting.claim.date.format",
				fmt.Sprintf("Posting '%s' claim occurrenceDate must be a YYYY-MM-DD calendar date.", posting.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		if !IsValidIsoDate(rule.StartDate) {
			continue // reported by validateRuleSchedules
		}
		if CompareIsoDates(claim.OccurrenceDate, rule.StartDate) < 0 {
			addIssue(issues, types.SeverityError, "posting.claim.date.range",
				fmt.Sprintf("Posting '%s' claims %s, which is before rule '%s' starts.", posting.ID, claim.OccurrenceDate, rule.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		scheduled := RuleScheduleDates(rule, claim.OccurrenceDate)
		if len(scheduled) == 0 || scheduled[len(scheduled)-1] != claim.OccurrenceDate {
			addIssue(issues, types.SeverityError, "posting.claim.date.unscheduled",
				fmt.Sprintf("Posting '%s' claims %s, which is not a scheduled occurrence of rule '%s'.", posting.ID, claim.OccurrenceDate, rule.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		key := claim.RuleID + "\x00" + claim.OccurrenceDate
		if claimed[key] {
			addIssue(issues, types.SeverityError, "posting.claim.duplicate",
				fmt.Sprintf("Rule '%s' occurrence on %s is claimed more than once.", claim.RuleID, claim.OccurrenceDate),
				base...)
			continue
		}
		claimed[key] = true
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func validateAccountBounds(issues *[]types.ModelValidationIssue, accounts []types.Account) {
	for index, account := range accounts {
		if account.MinBalanceValue() > account.MaxBalanceValue() {
			addIssue(issues, types.SeverityError, "account.balance.bounds",
				fmt.Sprintf("minBalance (%v) must not exceed maxBalance (%v).", formatBound(account.MinBalanceValue()), formatBound(account.MaxBalanceValue())),
				[]any{"accounts", index}...)
		}
	}
}

func formatBound(value float64) string {
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	return fmt.Sprintf("%v", value)
}

// SummarizeValidationIssues separates errors and warnings and reports validity.
func SummarizeValidationIssues(issues []types.ModelValidationIssue) (errors, warnings []types.ModelValidationIssue, isValid bool) {
	errors = []types.ModelValidationIssue{}
	warnings = []types.ModelValidationIssue{}
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			errors = append(errors, issue)
		} else if issue.Severity == types.SeverityWarning {
			warnings = append(warnings, issue)
		}
	}
	return errors, warnings, len(errors) == 0
}

func joinAccountKinds() string {
	names := make([]string, 0, len(types.AccountKinds()))
	for _, kind := range types.AccountKinds() {
		names = append(names, string(kind))
	}
	return strings.Join(names, ", ")
}
