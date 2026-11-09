package domain

import (
	"fmt"
	"math"
	"strconv"
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
// stable validation order. It covers finance records plus forecast
// evaluation configuration: simulation and evaluation writes use it.
func ValidateFinancialModel(model *types.FinancialModel) []types.ModelValidationIssue {
	issues := validateModel(model, true)
	if model != nil {
		validateAccountDisplays(&issues, model)
	}
	return issues
}

// ValidateFinanceModel runs the pure finance subset used by ordinary
// records, reads, and historical current-position replay. It excludes
// every evaluation-owned check (instance identity, config shape, and
// account references), so a broken forecast can never block finance
// work. Finance writes use ValidateFinanceWriteChange instead, which
// adds back the reference guard for newly introduced orphans.
func ValidateFinanceModel(model *types.FinancialModel) []types.ModelValidationIssue {
	issues := validateModel(model, false)
	if model != nil {
		validateAccountDisplays(&issues, model)
	}
	return issues
}

// EvaluationReferenceIssues reports dangling evaluation account
// references without running finance or evaluation config-shape checks.
// Finance row writes snapshot the stored baseline to reject only newly
// introduced orphans while tolerating preexisting forecast breakage.
func EvaluationReferenceIssues(model *types.FinancialModel) []types.ModelValidationIssue {
	if model == nil {
		return []types.ModelValidationIssue{}
	}
	accountIDs := make(map[string]bool, len(model.Accounts))
	for _, account := range model.Accounts {
		accountIDs[account.ID] = true
	}
	issues := []types.ModelValidationIssue{}
	validateEvaluationAccountReferences(&issues, model, accountIDs)
	return issues
}

// ValidateFinanceWriteChange gates one finance row write. It reports the
// candidate's finance errors plus evaluation reference errors the change
// newly introduces relative to the stored baseline. Preexisting forecast
// reference, config-shape, and identity errors never block repairing
// unrelated valid financial rows.
func ValidateFinanceWriteChange(storedReferences []types.ModelValidationIssue, candidate *types.FinancialModel) []types.ModelValidationIssue {
	issues := ValidateFinanceModel(candidate)
	known := make(map[string]bool, len(storedReferences))
	for _, issue := range storedReferences {
		if issue.Severity == types.SeverityError {
			known[referenceIssueKey(issue)] = true
		}
	}
	for _, issue := range EvaluationReferenceIssues(candidate) {
		if issue.Severity == types.SeverityError && !known[referenceIssueKey(issue)] {
			issues = append(issues, issue)
		}
	}
	return issues
}

func referenceIssueKey(issue types.ModelValidationIssue) string {
	return issue.Code + "\x00" + issue.Message
}

func validateModel(model *types.FinancialModel, includeEvaluation bool) []types.ModelValidationIssue {
	issues := []types.ModelValidationIssue{}
	accountIDs := make(map[string]bool, len(model.Accounts))
	accountIDList := make([]string, len(model.Accounts))
	for i, account := range model.Accounts {
		accountIDs[account.ID] = true
		accountIDList[i] = account.ID
	}
	validateUniqueIDs(&issues, accountIDList, "account.id", func(index int, field string) []any {
		return pathWithField([]any{"accounts", index}, field)
	})
	transactionIDList := make([]string, len(model.Transactions))
	for i, transaction := range model.Transactions {
		transactionIDList[i] = transaction.ID
	}
	validateUniqueIDs(&issues, transactionIDList, "transaction.id", func(index int, field string) []any {
		return pathWithField([]any{"transactions", index}, field)
	})
	ruleIDList := make([]string, len(model.Schedules))
	for i, rule := range model.Schedules {
		ruleIDList[i] = rule.ID
	}
	validateUniqueIDs(&issues, ruleIDList, "rule.id", func(index int, field string) []any {
		return pathWithField([]any{"schedules", index}, field)
	})
	purchaseIDList := make([]string, len(model.PlannedPurchases))
	for i, purchase := range model.PlannedPurchases {
		purchaseIDList[i] = purchase.ID
	}
	validateUniqueIDs(&issues, purchaseIDList, "plannedPurchase.id", func(index int, field string) []any {
		return pathWithField([]any{"plannedPurchases", index}, field)
	})
	if includeEvaluation {
		validateEvaluationInstanceIDs(&issues, model)
	}

	// Transaction identity checks: transaction, rule, and planned-purchase IDs share
	// one namespace with account IDs.
	transactionIDs := make(map[string]bool, len(model.Transactions)+len(model.Schedules)+len(model.PlannedPurchases))
	for _, transaction := range model.Transactions {
		transactionIDs[transaction.ID] = true
	}
	for index, rule := range model.Schedules {
		if transactionIDs[rule.ID] {
			addIssue(&issues, types.SeverityError, "rule.id.collision",
				fmt.Sprintf("Schedule ID '%s' collides with a transaction ID. Transaction and schedule IDs share one namespace.", rule.ID),
				pathWithField([]any{"schedules", index}, "id")...)
		}
		transactionIDs[rule.ID] = true
	}
	for index, purchase := range model.PlannedPurchases {
		if transactionIDs[purchase.ID] {
			addIssue(&issues, types.SeverityError, "plannedPurchase.id.collision",
				fmt.Sprintf("Planned purchase ID '%s' collides with a transaction or schedule ID. IDs must be unique across transactions and purchases.", purchase.ID),
				pathWithField([]any{"plannedPurchases", index}, "id")...)
		}
		transactionIDs[purchase.ID] = true
	}

	// Account identity checks.
	for index, account := range model.Accounts {
		if transactionIDs[account.ID] {
			addIssue(&issues, types.SeverityError, "account.id.collision",
				fmt.Sprintf("Account ID '%s' collides with a transaction or schedule ID. IDs must be unique across accounts, transactions, and schedules.", account.ID),
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
	for index, checkpoint := range model.Checkpoints {
		if !accountIDs[checkpoint.AccountID] {
			addIssue(&issues, types.SeverityError, "checkpoint.account.missing",
				fmt.Sprintf("Checkpoint account '%s' does not exist.", checkpoint.AccountID),
				pathWithField([]any{"checkpoints", index}, "AccountId")...)
		}
		if checkpoint.ObservedAt <= 0 {
			addIssue(&issues, types.SeverityError, "checkpoint.observedAt.required",
				fmt.Sprintf("Checkpoint for '%s' needs its exact observation time (Unix seconds).", checkpoint.AccountID),
				pathWithField([]any{"checkpoints", index}, "observedAt")...)
		}
		// Timestamp-only key: account plus exact instant. Multiple
		// observations per day survive; only the same instant collides.
		key := checkpoint.AccountID + "\x00" + strconv.FormatInt(checkpoint.ObservedAt, 10)
		if checkpointKeys[key] {
			addIssue(&issues, types.SeverityError, "checkpoint.account-date.duplicate",
				fmt.Sprintf("Account '%s' has more than one checkpoint at the same instant %d.", checkpoint.AccountID, checkpoint.ObservedAt),
				[]any{"checkpoints", index}...)
		}
		checkpointKeys[key] = true
	}

	dependencies := validateTransactionAmounts(&issues, model, accountIDs, transactionIDs)
	validatePurchases(&issues, model, dependencies)
	validateTransactionDependencies(&issues, model, dependencies)
	validateTransactionRoutes(&issues, model.Transactions, accountIDs)
	validateSchedules(&issues, model, accountIDs)
	validateTransactionClaims(&issues, model)
	validateAccountBounds(&issues, model.Accounts)
	if includeEvaluation {
		validateEvaluationConfigs(&issues, model)
		validateEvaluationAccountReferences(&issues, model, accountIDs)
	}
	validatePaymentTerms(&issues, model, accountIDs)
	validatePaymentTermsCoverage(&issues, model)

	return issues
}

func pathWithField(path []any, field string) []any {
	out := make([]any, 0, len(path)+1)
	out = append(out, path...)
	return append(out, field)
}

func validateEvaluationInstanceIDs(issues *[]types.ModelValidationIssue, model *types.FinancialModel) {
	seen := map[string]bool{}
	// Single pass over Tables(): no per-type ByType lookup, and new tables
	// ride along with zero changes here.
	for _, table := range model.Evaluations.Tables() {
		for _, instance := range *table.Rows {
			if seen[instance.InstanceID] {
				addIssue(issues, types.SeverityError, "evaluation.instanceId.duplicate",
					fmt.Sprintf("ID '%s' is duplicated across behavior configuration files.", instance.InstanceID),
					[]any{"evaluations", table.Type}...)
				continue
			}
			seen[instance.InstanceID] = true
		}
	}
}

func validateEvaluationConfigs(issues *[]types.ModelValidationIssue, model *types.FinancialModel) {
	// Single pass over Tables(): config validation shares the iteration
	// instead of re-expanding every table a second time.
	for _, table := range model.Evaluations.Tables() {
		definition, ok := evaluationRegistryInstance.Get(table.Type)
		if !ok {
			continue
		}
		for index, instance := range *table.Rows {
			if err := definition.Base().ValidateConfig(instance.Config); err != nil {
				path := []any{"evaluations", table.Type, index}
				addIssue(issues, types.SeverityError, "evaluation.config.invalid", err.Error(), path...)
			}
		}
	}
}

// validateEvaluationAccountReferences checks that an account balance evaluation names
// an account the model actually contains. A dangling reference would
// otherwise evaluate as never reached with no diagnostic.
func validateEvaluationAccountReferences(issues *[]types.ModelValidationIssue, model *types.FinancialModel, accountIDs map[string]bool) {
	for index, item := range model.Evaluations.AccountBalance {
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
	for index, item := range model.Evaluations.CycleFulfillment {
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

// validateTransactionAmounts validates amount descriptors for manual transactions
// and schedule templates together. References may name transaction or schedule IDs, so
// the dependency graph spans both.
func validateTransactionAmounts(issues *[]types.ModelValidationIssue, model *types.FinancialModel, accountIDs map[string]bool, transactionIDsSet map[string]bool) map[string][]string {
	dependencies := map[string][]string{}
	validateAmount := func(id string, amount types.TransactionAmountResolution, path []any) {
		deps, err := ValidateAmountDescriptor(amount, &AmountReferenceContext{
			AccountIDs:     accountIDs,
			TransactionIDs: transactionIDsSet,
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
			addIssue(issues, types.SeverityError, "transaction.amount.invalid", message,
				pathWithField(path, "amount")...)
			return
		}
		dependencies[id] = deps
	}
	for index := range model.Transactions {
		transaction := &model.Transactions[index]
		validateAmount(transaction.ID, transaction.Amount, []any{"transactions", index})
		if CountVolatileRateInputs(transaction.Amount) > 1 {
			addIssue(issues, types.SeverityError, "transaction.amount.multiple_volatile_rates",
				"Amounts carry at most one volatile provider input: one transaction shares one pre-sampled annual rate.",
				pathWithField([]any{"transactions", index}, "amount")...)
		}
	}
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		validateAmount(rule.ID, rule.Amount, []any{"schedules", index})
		if CountVolatileRateInputs(rule.Amount) > 1 {
			addIssue(issues, types.SeverityError, "transaction.amount.multiple_volatile_rates",
				"Amounts carry at most one volatile provider input: one transaction shares one pre-sampled annual rate.",
				pathWithField([]any{"schedules", index}, "amount")...)
		}
	}
	return dependencies
}

func validateTransactionDependencies(issues *[]types.ModelValidationIssue, model *types.FinancialModel, dependencies map[string][]string) {
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

	for index := range model.Transactions {
		transaction := &model.Transactions[index]
		if !visit(transaction.ID) {
			continue
		}
		addIssue(issues, types.SeverityError, "transaction.amount.circular",
			fmt.Sprintf("Amount resolution for '%s' creates a circular transaction dependency.", transaction.ID),
			pathWithField([]any{"transactions", index}, "amount")...)
	}
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		if !visit(rule.ID) {
			continue
		}
		addIssue(issues, types.SeverityError, "transaction.amount.circular",
			fmt.Sprintf("Amount resolution for '%s' creates a circular transaction dependency.", rule.ID),
			pathWithField([]any{"schedules", index}, "amount")...)
	}
}

func validateTransactionRoutes(issues *[]types.ModelValidationIssue, transactions []types.Transaction, accountIDs map[string]bool) {
	for index := range transactions {
		transaction := &transactions[index]
		if transaction.SourceAccountID != nil && !accountIDs[*transaction.SourceAccountID] {
			addIssue(issues, types.SeverityError, "transaction.source.missing",
				fmt.Sprintf("Transaction source account '%s' does not exist.", *transaction.SourceAccountID),
				pathWithField([]any{"transactions", index}, "sourceAccountId")...)
		}
		if transaction.Destinations != nil {
			seen := map[string]bool{}
			for _, destinationID := range transaction.Destinations {
				if !accountIDs[destinationID] {
					addIssue(issues, types.SeverityError, "transaction.destination.missing",
						fmt.Sprintf("Transaction destination account '%s' does not exist.", destinationID),
						pathWithField([]any{"transactions", index}, "destinations")...)
				}
				if seen[destinationID] {
					addIssue(issues, types.SeverityError, "schedule.destinations.duplicate",
						fmt.Sprintf("Destination account '%s' appears more than once.", destinationID),
						pathWithField([]any{"transactions", index}, "destinations")...)
				}
				seen[destinationID] = true
			}
		}
		if transaction.SourceAccountID == nil && len(transaction.Destinations) == 0 {
			addIssue(issues, types.SeverityError, "transaction.accounts.empty",
				"Transactions must set sourceAccountId, destinations, or both.",
				[]any{"transactions", index}...)
		}
		if transaction.SourceAccountID != nil && containsString(transaction.Destinations, *transaction.SourceAccountID) {
			addIssue(issues, types.SeverityError, "transaction.accounts.same",
				"Transaction sourceAccountId must not appear in destinations.",
				[]any{"transactions", index}...)
		}
		// Pending seeds and void holds carry no posted date: the bridge
		// reports Posted == 0 until a charge posts.
		if transaction.PostedTime <= 0 && !transaction.Pending && !transaction.Void {
			addIssue(issues, types.SeverityError, "transaction.postedTime.invalid",
				fmt.Sprintf("Transaction '%s' posted time must be positive Unix seconds.", transaction.ID),
				pathWithField([]any{"transactions", index}, "postedTime")...)
		}
		if transaction.TransactionTime <= 0 {
			addIssue(issues, types.SeverityError, "transaction.transactionTime.invalid",
				fmt.Sprintf("Transaction '%s' transaction time must be positive Unix seconds.", transaction.ID),
				pathWithField([]any{"transactions", index}, "transactionTime")...)
		}
	}
}

// validateSchedules checks schedule routes, frequencies, and bounds.
func validateSchedules(issues *[]types.ModelValidationIssue, model *types.FinancialModel, accountIDs map[string]bool) {
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		base := []any{"schedules", index}
		if rule.SourceAccountID != nil && !accountIDs[*rule.SourceAccountID] {
			addIssue(issues, types.SeverityError, "schedule.source.missing",
				fmt.Sprintf("Schedule source account '%s' does not exist.", *rule.SourceAccountID),
				pathWithField(base, "sourceAccountId")...)
		}
		if rule.Destinations != nil {
			seen := map[string]bool{}
			for _, destinationID := range rule.Destinations {
				if !accountIDs[destinationID] {
					addIssue(issues, types.SeverityError, "schedule.destination.missing",
						fmt.Sprintf("Schedule destination account '%s' does not exist.", destinationID),
						pathWithField(base, "destinations")...)
				}
				if seen[destinationID] {
					addIssue(issues, types.SeverityError, "schedule.destinations.duplicate",
						fmt.Sprintf("Destination account '%s' appears more than once.", destinationID),
						pathWithField(base, "destinations")...)
				}
				seen[destinationID] = true
			}
		}
		if rule.SourceAccountID == nil && len(rule.Destinations) == 0 {
			addIssue(issues, types.SeverityError, "schedule.accounts.empty",
				"Schedules must set sourceAccountId, destinations, or both.",
				base...)
		}
		if rule.SourceAccountID != nil && containsString(rule.Destinations, *rule.SourceAccountID) {
			addIssue(issues, types.SeverityError, "schedule.accounts.same",
				"Schedule sourceAccountId must not appear in destinations.",
				base...)
		}
		switch rule.Frequency {
		case types.FrequencyDaily, types.FrequencyWeekly, types.FrequencyMonthly, types.FrequencyQuarterly, types.FrequencyAnnual:
		default:
			addIssue(issues, types.SeverityError, "schedule.frequency.invalid",
				fmt.Sprintf("Schedule '%s' has frequency '%s'. Expected daily, weekly, monthly, quarterly, or annual.", rule.ID, rule.Frequency),
				pathWithField(base, "frequency")...)
		}
		if !IsValidIsoDate(rule.StartDate) {
			addIssue(issues, types.SeverityError, "schedule.start-date.format",
				fmt.Sprintf("Schedule '%s' startDate must be a YYYY-MM-DD calendar date.", rule.ID),
				pathWithField(base, "startDate")...)
		}
		if rule.EndDate != nil && !IsValidIsoDate(*rule.EndDate) {
			addIssue(issues, types.SeverityError, "schedule.end-date.format",
				fmt.Sprintf("Schedule '%s' endDate must be a YYYY-MM-DD calendar date.", rule.ID),
				pathWithField(base, "endDate")...)
		}
		if rule.EndDate != nil &&
			IsValidIsoDate(rule.StartDate) &&
			IsValidIsoDate(*rule.EndDate) &&
			CompareIsoDates(*rule.EndDate, rule.StartDate) < 0 {
			addIssue(issues, types.SeverityError, "schedule.window.invalid",
				"Schedule endDate must be the same as or later than startDate.",
				pathWithField(base, "endDate")...)
		}
	}
}

// validateTransactionClaims checks that each claim names a real scheduled
// occurrence of its schedule, and that no occurrence is claimed twice. Claims
// are manual: validation only verifies the named occurrence exists.
func validateTransactionClaims(issues *[]types.ModelValidationIssue, model *types.FinancialModel) {
	rulesByID := make(map[string]*types.Schedule, len(model.Schedules))
	for index := range model.Schedules {
		rule := &model.Schedules[index]
		rulesByID[rule.ID] = rule
	}
	claimed := map[string]bool{}
	for index := range model.Transactions {
		transaction := &model.Transactions[index]
		if transaction.Claim == nil {
			continue
		}
		base := []any{"transactions", index, "claim"}
		claim := transaction.Claim
		rule, ok := rulesByID[claim.ScheduleID]
		if !ok {
			addIssue(issues, types.SeverityError, "transaction.claim.schedule.missing",
				fmt.Sprintf("Transaction '%s' claims schedule '%s', which does not exist.", transaction.ID, claim.ScheduleID),
				append(base, "scheduleId")...)
			continue
		}
		if !IsValidIsoDate(claim.OccurrenceDate) {
			addIssue(issues, types.SeverityError, "transaction.claim.date.format",
				fmt.Sprintf("Transaction '%s' claim occurrenceDate must be a YYYY-MM-DD calendar date.", transaction.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		if !IsValidIsoDate(rule.StartDate) {
			continue // reported by validateSchedules
		}
		if CompareIsoDates(claim.OccurrenceDate, rule.StartDate) < 0 {
			addIssue(issues, types.SeverityError, "transaction.claim.date.range",
				fmt.Sprintf("Transaction '%s' claims %s, which is before schedule '%s' starts.", transaction.ID, claim.OccurrenceDate, rule.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		scheduled := ruleOccursOn(rule, claim.OccurrenceDate)
		if !scheduled {
			addIssue(issues, types.SeverityError, "transaction.claim.date.unscheduled",
				fmt.Sprintf("Transaction '%s' claims %s, which is not a scheduled occurrence of schedule '%s'.", transaction.ID, claim.OccurrenceDate, rule.ID),
				append(base, "occurrenceDate")...)
			continue
		}
		key := claim.ScheduleID + "\x00" + claim.OccurrenceDate
		if claimed[key] {
			addIssue(issues, types.SeverityError, "transaction.claim.duplicate",
				fmt.Sprintf("Schedule '%s' occurrence on %s is claimed more than once.", claim.ScheduleID, claim.OccurrenceDate),
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
