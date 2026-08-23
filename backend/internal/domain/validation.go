package domain

import (
	"fmt"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Financial-model cross-validation ported from validation/*.ts.

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
// TS-equivalent order.
func ValidateFinancialModel(document *types.FinancialModelDocument, incomeData *types.IncomeDataSnapshot) []types.ModelValidationIssue {
	issues := []types.ModelValidationIssue{}
	accountIDs := make(map[string]bool, len(document.Accounts))
	for _, account := range document.Accounts {
		accountIDs[account.ID] = true
	}
	postingIDs := make(map[string]bool, len(document.Postings))
	for _, posting := range document.Postings {
		postingIDs[posting.ID] = true
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
	validateEvaluationInstanceIDs(&issues, document)

	// Account identity checks.
	for index, account := range document.Accounts {
		if postingIDs[account.ID] {
			addIssue(&issues, types.SeverityError, "account.id.collision",
				fmt.Sprintf("Account ID '%s' collides with a posting ID. IDs must be unique across accounts and postings.", account.ID),
				pathWithField([]any{"accounts", index}, "id")...)
		}
		if account.Enabled && account.Color == nil {
			addIssue(&issues, types.SeverityWarning, "account.color.missing",
				fmt.Sprintf("Enabled account '%s' has no chart color. Charts will use a neutral fallback until a color is provided.", account.ID),
				pathWithField([]any{"accounts", index}, "color")...)
		}
	}

	checkpointKeys := map[string]bool{}
	for index, checkpoint := range document.Checkpoints {
		if !accountIDs[checkpoint.AccountID] {
			addIssue(&issues, types.SeverityError, "checkpoint.account.missing",
				fmt.Sprintf("Checkpoint account '%s' does not exist.", checkpoint.AccountID),
				pathWithField([]any{"checkpoints", index}, "AccountId")...)
		}
		key := checkpoint.AccountID + "\x00" + checkpoint.Date
		if checkpointKeys[key] {
			addIssue(&issues, types.SeverityError, "checkpoint.account-date.duplicate",
				fmt.Sprintf("Account '%s' has more than one checkpoint on %s.", checkpoint.AccountID, checkpoint.Date),
				[]any{"checkpoints", index}...)
		}
		checkpointKeys[key] = true
	}

	dependencies := validatePostingAmounts(&issues, document.Postings, accountIDs, incomeData)
	validatePostingDependencies(&issues, document.Postings, dependencies)
	validatePostingRoutes(&issues, document.Postings, accountIDs)
	validateAccountBounds(&issues, document.Accounts)
	validateEvaluationConfigs(&issues, document)

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
	case types.EvaluationTypePostingFulfillment:
		for _, item := range document.Evaluations.PostingFulfillment {
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
			case types.EvaluationTypePostingFulfillment:
				err = ValidateFulfillmentConfig(instance.Config)
			}
			if err != nil {
				path := []any{"evaluations", evaluationType, index}
				addIssue(issues, types.SeverityError, "evaluation.config.invalid", err.Error(), path...)
			}
		}
	}
}

func validatePostingAmounts(issues *[]types.ModelValidationIssue, postings []types.Posting, accountIDs map[string]bool, incomeData *types.IncomeDataSnapshot) map[string][]string {
	postingIDsSet := make(map[string]bool, len(postings))
	for _, posting := range postings {
		postingIDsSet[posting.ID] = true
	}
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
	for index := range postings {
		posting := &postings[index]
		deps, err := ValidateAmountDescriptor(posting.Amount, &AmountReferenceContext{
			AccountIDs:      accountIDs,
			PostingIDs:      postingIDsSet,
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
				pathWithField([]any{"postings", index}, "amount")...)
			continue
		}
		dependencies[posting.ID] = deps
		if posting.Amount.Resolver != "expression" &&
			(posting.AnnualRate != 0 || posting.AnnualGrowthRate != 0 || posting.Volatility != 0) {
			addIssue(issues, types.SeverityError, "posting.amount.non_expression_rates",
				"Non-expression amount resolvers require annualRate, annualGrowthRate, and volatility to be zero.",
				pathWithField([]any{"postings", index}, "amount")...)
		}
	}
	return dependencies
}

func validatePostingDependencies(issues *[]types.ModelValidationIssue, postings []types.Posting, dependencies map[string][]string) {
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

	for index := range postings {
		posting := &postings[index]
		if !visit(posting.ID) {
			continue
		}
		addIssue(issues, types.SeverityError, "posting.amount.circular",
			fmt.Sprintf("Amount resolution for '%s' creates a circular posting dependency.", posting.ID),
			pathWithField([]any{"postings", index}, "amount")...)
	}
}

func validatePostingRoutes(issues *[]types.ModelValidationIssue, postings []types.Posting, accountIDs map[string]bool) {
	enabledIncomeCount := 0
	for _, posting := range postings {
		if posting.Enabled && posting.Amount.Resolver == "income" {
			enabledIncomeCount++
		}
	}
	if enabledIncomeCount > 1 {
		addIssue(issues, types.SeverityError, "posting.income.multiple",
			"Only one enabled income posting is supported for the household income pipeline.",
			[]any{"postings"}...)
	}

	for index := range postings {
		posting := &postings[index]
		if posting.Amount.Resolver == "income" {
			if posting.SourceAccountID != nil {
				addIssue(issues, types.SeverityError, "posting.income.source.invalid",
					"Income postings cannot withdraw from an account.",
					pathWithField([]any{"postings", index}, "sourceAccountId")...)
			}
			if len(posting.Destinations) == 0 {
				addIssue(issues, types.SeverityError, "posting.income.destination.missing",
					"Income postings must deposit their remaining amount into at least one account.",
					pathWithField([]any{"postings", index}, "destinations")...)
			}
			if posting.AnnualCap != nil {
				addIssue(issues, types.SeverityError, "posting.income.cap.invalid",
					"Income postings use resolver-level caps, not a posting annual cap.",
					pathWithField([]any{"postings", index}, "annualCap")...)
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
		if posting.SourceAccountID == nil && posting.Destinations == nil {
			addIssue(issues, types.SeverityError, "posting.accounts.empty",
				"Postings must set sourceAccountId, destinations, or both.",
				[]any{"postings", index}...)
		}
		if posting.SourceAccountID != nil && containsString(posting.Destinations, *posting.SourceAccountID) {
			addIssue(issues, types.SeverityError, "posting.accounts.same",
				"Posting sourceAccountId must not appear in destinations.",
				[]any{"postings", index}...)
		}
		if posting.EndDate != nil && CompareIsoDates(*posting.EndDate, posting.StartDate) < 0 {
			addIssue(issues, types.SeverityError, "posting.schedule.invalid",
				"Posting endDate must be the same as or later than startDate.",
				pathWithField([]any{"postings", index}, "endDate")...)
		}
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

// SummarizeValidationIssues mirrors summarizeValidationIssues.
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
