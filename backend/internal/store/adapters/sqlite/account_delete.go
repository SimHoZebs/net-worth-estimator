package sqlite

import (
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type accountDeletionPlan struct {
	accountIDs     []string
	accounts       map[string]bool
	transactionIDs []string
	transactions   map[string]bool
	ruleIDs        []string
	rules          map[string]bool
	purchaseIDs    []string
	evaluationIDs  []string
}

// DeleteAccount removes one manual account and its dependent financial history
// in one transaction. A grouped loan resolves to its complete visible account
// set. Linked accounts and bank-owned facts are never deletable.
func (s *sqliteStore) DeleteAccount(id string) error {
	return s.deleteAccount(id, false)
}

// DeleteLoan keeps the loan-specific entry point while sharing the same
// transactional cascade as ordinary account deletion.
func (s *sqliteStore) DeleteLoan(id string) error {
	return s.deleteAccount(id, true)
}

func (s *sqliteStore) deleteAccount(id string, loanOnly bool) error {
	return withRowTx(s.db, func(tx *userTx) error {
		baseline, err := loadModel(tx)
		if err != nil {
			return err
		}
		if baseline == nil {
			return NotFound(id)
		}
		if _, ok := supersedeFindAccount(baseline, id); !ok {
			return NotFound(id)
		}
		accountIDs, ownerID, err := resolveDeletionAccounts(baseline, id)
		if err != nil {
			return err
		}
		if loanOnly && ownerID != id {
			return NotFound(id)
		}
		accounts := stringSet(accountIDs)
		synced, err := deletionHasDirectSyncedEvidence(tx, baseline, accounts)
		if err != nil {
			return err
		}
		if synced {
			return store.ErrAccountSynced
		}
		owner, _ := supersedeFindAccount(baseline, ownerID)
		managedRuleIDs := []string{}
		if owner.Display != nil {
			managedRuleIDs = []string{owner.Display.InterestScheduleID, owner.Display.PaymentScheduleID}
		}
		plan, issues, err := buildAccountDeletionPlan(baseline, accountIDs, managedRuleIDs)
		if err != nil {
			return err
		}
		if hasValidationErrors(issues) {
			return store.AccountDeletionRejected{Issues: issues}
		}
		for _, transaction := range baseline.Transactions {
			if plan.transactions[transaction.ID] && transaction.Source != SourceUser {
				return store.ErrAccountSynced
			}
		}
		candidate := accountDeletionCandidate(baseline, plan)
		if issues = deletionValidationIssues(baseline, candidate); hasValidationErrors(issues) {
			return store.AccountDeletionRejected{Issues: issues}
		}
		if err := applyAccountDeletion(tx, plan); err != nil {
			return err
		}
		reloaded, err := loadModel(tx)
		if err != nil {
			return err
		}
		if reloaded == nil {
			return fmt.Errorf("delete account %s: model disappeared", id)
		}
		issues = deletionValidationIssues(baseline, reloaded)
		if hasValidationErrors(issues) {
			return store.AccountDeletionRejected{Issues: issues}
		}
		return nil
	})
}

func deletionValidationIssues(baseline, candidate *types.FinancialModel) []types.ModelValidationIssue {
	known := map[string]bool{}
	for _, issues := range [][]types.ModelValidationIssue{
		domain.ValidateFinanceModel(baseline),
		domain.EvaluationReferenceIssues(baseline),
	} {
		for _, issue := range issues {
			if issue.Severity == types.SeverityError {
				known[deletionIssueKey(issue)] = true
			}
		}
	}
	issues := []types.ModelValidationIssue{}
	for _, candidateIssues := range [][]types.ModelValidationIssue{
		domain.ValidateFinanceModel(candidate),
		domain.EvaluationReferenceIssues(candidate),
	} {
		for _, issue := range candidateIssues {
			if issue.Severity == types.SeverityError && !known[deletionIssueKey(issue)] {
				issues = append(issues, issue)
			}
		}
	}
	return issues
}

func deletionIssueKey(issue types.ModelValidationIssue) string {
	return issue.Code + "\x00" + issue.Message
}

func resolveDeletionAccounts(model *types.FinancialModel, id string) ([]string, string, error) {
	issues := domain.ValidateAccountDisplays(model)
	if hasValidationErrors(issues) {
		return nil, "", store.AccountDeletionRejected{Issues: issues}
	}
	target, ok := supersedeFindAccount(model, id)
	if !ok {
		return nil, "", NotFound(id)
	}
	ownerID := id
	components := []string{id}
	if target.Display != nil && !types.IsPassthroughDisplay(target.Display, id) {
		ownerID = id
		components = components[:0]
		for _, component := range target.Display.Components {
			components = append(components, component.AccountID)
		}
	} else {
		for _, account := range model.Accounts {
			if account.Display == nil || types.IsPassthroughDisplay(account.Display, account.ID) {
				continue
			}
			for _, component := range account.Display.Components {
				if component.AccountID == id {
					ownerID = account.ID
					components = components[:0]
					for _, member := range account.Display.Components {
						components = append(components, member.AccountID)
					}
					break
				}
			}
			if ownerID != id {
				break
			}
		}
	}
	selected := stringSet(components)
	ordered := make([]string, 0, len(selected))
	for _, account := range model.Accounts {
		if selected[account.ID] {
			ordered = append(ordered, account.ID)
		}
	}
	if len(ordered) != len(selected) {
		return nil, "", store.AccountDeletionRejected{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "account.display.invalid",
			Message:  "A loan component does not exist.",
			Path:     []any{"accounts", "display"},
		}}}
	}
	return ordered, ownerID, nil
}

func deletionHasDirectSyncedEvidence(tx *userTx, model *types.FinancialModel, accounts map[string]bool) (bool, error) {
	accountIDs := orderedAccountIDs(model, accounts)
	placeholders, args := sliceIDArgs(accountIDs)
	var links int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM account_links WHERE model_account_id IN (`+placeholders+`) AND user_id = :user_id`, args...).Scan(&links); err != nil {
		return false, fmt.Errorf("count linked accounts for deletion: %w", err)
	}
	if links > 0 {
		return true, nil
	}
	checkpoints, err := loadSyncedCheckpoints(tx)
	if err != nil {
		return false, err
	}
	for _, checkpoint := range checkpoints {
		if accounts[checkpoint.AccountID] {
			return true, nil
		}
	}
	transactions, err := loadSyncedTransactions(tx)
	if err != nil {
		return false, err
	}
	for _, transaction := range transactions {
		if transactionTouchesAccounts(transaction, accounts) {
			return true, nil
		}
	}
	return false, nil
}

type deletionAmountNode struct {
	dependencies []string
}

func buildAccountDeletionPlan(model *types.FinancialModel, accountIDs, managedRuleIDs []string) (accountDeletionPlan, []types.ModelValidationIssue, error) {
	plan := accountDeletionPlan{
		accountIDs:   accountIDs,
		accounts:     stringSet(accountIDs),
		transactions: map[string]bool{},
		rules:        map[string]bool{},
	}
	references := domain.AmountReferenceContext{
		AccountIDs:     map[string]bool{},
		TransactionIDs: map[string]bool{},
	}
	for _, account := range model.Accounts {
		references.AccountIDs[account.ID] = true
	}
	for _, transaction := range model.Transactions {
		references.TransactionIDs[transaction.ID] = true
	}
	for _, rule := range model.Schedules {
		references.TransactionIDs[rule.ID] = true
	}
	nodes := map[string]deletionAmountNode{}
	transactionSet := map[string]bool{}
	dependents := map[string][]string{}
	issues := []types.ModelValidationIssue{}
	queue := []string{}
	enqueue := func(id string) {
		if _, exists := nodes[id]; exists && !containsID(queue, id) {
			queue = append(queue, id)
		}
	}
	addNode := func(id string, amount types.TransactionAmountResolution, path []any, direct bool) error {
		dependencies, err := domain.ValidateAmountDescriptor(amount, &references)
		if err != nil {
			issues = append(issues, types.ModelValidationIssue{
				Severity: types.SeverityError,
				Code:     "transaction.amount.invalid",
				Message:  err.Error(),
				Path:     append(path, "amount"),
			})
			return err
		}
		accountRefs, err := domain.AmountDescriptorAccountIDs(amount)
		if err != nil {
			issues = append(issues, types.ModelValidationIssue{
				Severity: types.SeverityError,
				Code:     "transaction.amount.invalid",
				Message:  err.Error(),
				Path:     append(path, "amount"),
			})
			return err
		}
		nodes[id] = deletionAmountNode{dependencies: dependencies}
		for _, dependency := range dependencies {
			dependents[dependency] = append(dependents[dependency], id)
		}
		if direct || referencesAny(accountRefs, plan.accounts) {
			enqueue(id)
		}
		return nil
	}
	for index, transaction := range model.Transactions {
		transactionSet[transaction.ID] = true
		_ = addNode(transaction.ID, transaction.Amount, []any{"transactions", index}, transactionTouchesAccounts(transaction, plan.accounts))
	}
	for index, rule := range model.Schedules {
		_ = addNode(rule.ID, rule.Amount, []any{"schedules", index}, ruleTouchesAccounts(rule, plan.accounts))
	}
	for _, ruleID := range managedRuleIDs {
		if ruleID == "" {
			continue
		}
		if _, exists := nodes[ruleID]; !exists {
			issues = append(issues, types.ModelValidationIssue{
				Severity: types.SeverityError,
				Code:     "account.display.invalid",
				Message:  "A managed loan schedule does not exist.",
				Path:     []any{"accounts", "display"},
			})
			continue
		}
		enqueue(ruleID)
	}
	if hasValidationErrors(issues) {
		return plan, issues, nil
	}
	for cursor := 0; cursor < len(queue); cursor++ {
		id := queue[cursor]
		if transactionSet[id] {
			plan.transactions[id] = true
		} else {
			plan.rules[id] = true
		}
		for _, dependent := range dependents[id] {
			if !plan.transactions[dependent] && !plan.rules[dependent] && !containsID(queue, dependent) {
				queue = append(queue, dependent)
			}
		}
	}
	for _, transaction := range model.Transactions {
		if plan.transactions[transaction.ID] {
			plan.transactionIDs = append(plan.transactionIDs, transaction.ID)
		}
	}
	for _, rule := range model.Schedules {
		if plan.rules[rule.ID] {
			plan.ruleIDs = append(plan.ruleIDs, rule.ID)
		}
	}
	for _, purchase := range model.PlannedPurchases {
		if purchase.FundingAccountID != nil && plan.accounts[*purchase.FundingAccountID] {
			plan.purchaseIDs = append(plan.purchaseIDs, purchase.ID)
		}
	}
	evaluationIDs, err := dependentDeletionEvaluations(model, plan)
	if err != nil {
		return plan, nil, err
	}
	plan.evaluationIDs = evaluationIDs
	return plan, issues, nil
}

func orderedAccountIDs(model *types.FinancialModel, selected map[string]bool) []string {
	ids := make([]string, 0, len(selected))
	for _, account := range model.Accounts {
		if selected[account.ID] {
			ids = append(ids, account.ID)
		}
	}
	return ids
}

func referencesAny(ids []string, references map[string]bool) bool {
	for _, id := range ids {
		if references[id] {
			return true
		}
	}
	return false
}

func accountDeletionCandidate(model *types.FinancialModel, plan accountDeletionPlan) *types.FinancialModel {
	candidate := *model
	candidate.Accounts = filterDeletionRows(model.Accounts, func(account types.Account) bool { return !plan.accounts[account.ID] })
	candidate.Checkpoints = filterDeletionRows(model.Checkpoints, func(checkpoint types.Checkpoint) bool { return !plan.accounts[checkpoint.AccountID] })
	candidate.Transactions = filterDeletionRows(model.Transactions, func(transaction types.Transaction) bool { return !plan.transactions[transaction.ID] })
	for index := range candidate.Transactions {
		transaction := &candidate.Transactions[index]
		if transaction.Claim != nil && plan.rules[transaction.Claim.ScheduleID] {
			transaction.Claim = nil
		}
	}
	candidate.Schedules = filterDeletionRows(model.Schedules, func(rule types.Schedule) bool { return !plan.rules[rule.ID] })
	candidate.PaymentTerms = filterDeletionRows(model.PaymentTerms, func(terms types.PaymentTerms) bool { return !plan.accounts[terms.AccountID] })
	candidate.PlannedPurchases = filterDeletionRows(model.PlannedPurchases, func(purchase types.PlannedPurchase) bool { return !containsID(plan.purchaseIDs, purchase.ID) })
	candidate.Evaluations = types.EmptyEvaluationTables()
	for _, table := range model.Evaluations.Tables() {
		target := candidate.Evaluations.ByType(table.Type)
		*target = filterDeletionRows(*table.Rows, func(item types.EvaluationInstance[types.JsonValue]) bool {
			return !containsID(plan.evaluationIDs, item.InstanceID)
		})
	}
	return &candidate
}

func filterDeletionRows[T any](rows []T, keep func(T) bool) []T {
	if rows == nil {
		return nil
	}
	out := make([]T, 0, len(rows))
	for _, row := range rows {
		if keep(row) {
			out = append(out, row)
		}
	}
	return out
}

func dependentDeletionEvaluations(model *types.FinancialModel, plan accountDeletionPlan) ([]string, error) {
	references := domain.AmountReferenceContext{AccountIDs: map[string]bool{}, TransactionIDs: map[string]bool{}}
	for _, account := range model.Accounts {
		references.AccountIDs[account.ID] = true
	}
	for _, transaction := range model.Transactions {
		references.TransactionIDs[transaction.ID] = true
	}
	for _, rule := range model.Schedules {
		references.TransactionIDs[rule.ID] = true
	}
	ids := []string{}
	for _, table := range model.Evaluations.Tables() {
		for _, item := range *table.Rows {
			raw, err := json.Marshal(item.Config)
			if err != nil {
				return nil, fmt.Errorf("marshal evaluation %s: %w", item.InstanceID, err)
			}
			dependent, err := evaluationDependsOnDeletion(table.Type, item.Config, plan, &references)
			if err != nil {
				// A malformed config cannot be rewritten safely. If it names a
				// deleted identity, remove the whole evaluation; otherwise keep it
				// as an unrelated diagnostic for the evaluation write boundary.
				if configReferencesIDs(string(raw), plan.accounts, plan.transactions, plan.rules) {
					dependent = true
				}
			}
			if dependent {
				ids = append(ids, item.InstanceID)
			}
		}
	}
	return ids, nil
}

func evaluationDependsOnDeletion(evalType string, config any, plan accountDeletionPlan, references *domain.AmountReferenceContext) (bool, error) {
	switch evalType {
	case types.EvaluationTypeAccountBalance:
		parsed, err := domain.ParseAccountBalanceConfig(config)
		return err == nil && plan.accounts[parsed.AccountID], err
	case types.EvaluationTypeCycleFulfillment:
		parsed, err := domain.ParseCycleFulfillmentConfig(config)
		return err == nil && referencesAny(parsed.AccountIDs, plan.accounts), err
	case types.EvaluationTypeTransactionFulfillment:
		parsed, err := domain.ParseFulfillmentConfig(config)
		return err == nil && referencesAny(parsed.TransactionIDs, plan.transactions), err
	case types.EvaluationTypeFinancialIndependence:
		parsed, err := domain.ParseFIPlan(config)
		if err != nil {
			return false, err
		}
		for _, source := range parsed.Sources {
			if plan.accounts[source.AccountID] || plan.transactions[source.TransactionID] {
				return true, nil
			}
		}
		return referencesAny(parsed.ContinuingTransactionIDs, plan.transactions), nil
	case types.EvaluationTypeWhatIf:
		raw, err := json.Marshal(config)
		if err != nil {
			return false, err
		}
		var parsed types.WhatIfConfig
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return false, err
		}
		if referencesAny(parsed.DisabledAccountIDs, plan.accounts) || referencesAny(parsed.DisabledTransactionIDs, plan.transactions) || referencesAny(parsed.DisabledScheduleIDs, plan.rules) {
			return true, nil
		}
		for _, account := range parsed.AddedAccounts {
			if plan.accounts[account.ID] || accountDisplayReferences(account.Display, plan.accounts) {
				return true, nil
			}
		}
		for _, transaction := range parsed.AddedTransactions {
			if plan.transactions[transaction.ID] || transactionTouchesAccounts(transaction, plan.accounts) || (transaction.Claim != nil && plan.rules[transaction.Claim.ScheduleID]) {
				return true, nil
			}
			dependent, err := deletionAmountReferences(transaction.Amount, plan, references)
			if err != nil || dependent {
				return dependent, err
			}
		}
		for _, rule := range parsed.AddedRules {
			if plan.rules[rule.ID] || ruleTouchesAccounts(rule, plan.accounts) {
				return true, nil
			}
			dependent, err := deletionAmountReferences(rule.Amount, plan, references)
			if err != nil || dependent {
				return dependent, err
			}
		}
	}
	return false, nil
}

func accountDisplayReferences(display *types.AccountDisplay, accounts map[string]bool) bool {
	if display == nil {
		return false
	}
	for _, component := range display.Components {
		if accounts[component.AccountID] {
			return true
		}
	}
	return false
}

func deletionAmountReferences(amount types.TransactionAmountResolution, plan accountDeletionPlan, references *domain.AmountReferenceContext) (bool, error) {
	accountIDs, err := domain.AmountDescriptorAccountIDs(amount)
	if err != nil {
		return false, err
	}
	if referencesAny(accountIDs, plan.accounts) {
		return true, nil
	}
	dependencies, err := domain.ValidateAmountDescriptor(amount, references)
	if err != nil {
		return false, err
	}
	return referencesAny(dependencies, plan.transactions) || referencesAny(dependencies, plan.rules), nil
}

func applyAccountDeletion(tx *userTx, plan accountDeletionPlan) error {
	if err := purgeProjectionArtifactsTx(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM analysis_payment_streams WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("delete analysis payment streams: %w", err)
	}
	if err := deleteStatementAllocationsTx(tx, plan.accounts, plan.transactions); err != nil {
		return err
	}
	if err := deleteTransactionsTx(tx, plan.transactionIDs); err != nil {
		return err
	}
	for _, ruleID := range plan.ruleIDs {
		if err := deleteRuleTx(tx, ruleID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM analysis_promotions WHERE rule_id = ? AND user_id = :user_id`, ruleID); err != nil {
			return fmt.Errorf("delete analysis promotion for rule %s: %w", ruleID, err)
		}
	}
	for _, accountID := range plan.accountIDs {
		if _, err := tx.Exec(`DELETE FROM analysis_findings WHERE json_extract(detection_json, '$.accountId') = ? AND user_id = :user_id`, accountID); err != nil {
			return fmt.Errorf("delete account analysis findings %s: %w", accountID, err)
		}
	}
	for _, evaluationID := range plan.evaluationIDs {
		if _, err := tx.Exec(`DELETE FROM pinned_evaluations WHERE instance_id = ? AND user_id = :user_id`, evaluationID); err != nil {
			return fmt.Errorf("unpin deleted evaluation %s: %w", evaluationID, err)
		}
		if _, err := tx.Exec(`DELETE FROM evaluations WHERE instance_id = ? AND user_id = :user_id`, evaluationID); err != nil {
			return fmt.Errorf("delete dependent evaluation %s: %w", evaluationID, err)
		}
		if err := releaseRowID(tx, evaluationID); err != nil {
			return err
		}
	}
	for _, purchaseID := range plan.purchaseIDs {
		if _, err := tx.Exec(`DELETE FROM planned_purchases WHERE id = ? AND user_id = :user_id`, purchaseID); err != nil {
			return fmt.Errorf("delete planned purchase %s: %w", purchaseID, err)
		}
		if err := releaseRowID(tx, purchaseID); err != nil {
			return err
		}
	}
	placeholders, args := sliceIDArgs(plan.accountIDs)
	if _, err := tx.Exec(`DELETE FROM payment_terms WHERE model_account_id IN (`+placeholders+`) AND user_id = :user_id`, args...); err != nil {
		return fmt.Errorf("delete payment terms: %w", err)
	}
	if err := deleteCheckpointsTx(tx, plan.accountIDs); err != nil {
		return err
	}
	if err := rewriteSafeSpendingSettings(tx, func(settings *types.SafeSpendingSettings) {
		settings.AccountIDs = removeIDs(settings.AccountIDs, plan.accounts)
		settings.SpendingAccountIDs = removeIDs(settings.SpendingAccountIDs, plan.accounts)
		settings.TransactionIDs = removeIDs(settings.TransactionIDs, plan.transactions)
		settings.IncomeScheduleIDs = removeIDs(settings.IncomeScheduleIDs, plan.rules)
	}); err != nil {
		return err
	}
	if err := stripSharingPolicyAccounts(tx, plan.accounts); err != nil {
		return err
	}
	result, err := tx.Exec(`DELETE FROM accounts WHERE id IN (`+placeholders+`) AND user_id = :user_id`, args...)
	if err != nil {
		return fmt.Errorf("delete accounts: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != int64(len(plan.accountIDs)) {
		return fmt.Errorf("delete accounts: removed %d of %d", affected, len(plan.accountIDs))
	}
	for _, accountID := range plan.accountIDs {
		if err := releaseRowID(tx, accountID); err != nil {
			return err
		}
	}
	return invalidateProjectionStateTx(tx)
}

func deleteStatementAllocationsTx(tx *userTx, accounts, transactions map[string]bool) error {
	rows, err := tx.Query(`SELECT id, statement_id, transaction_id FROM statement_allocations WHERE user_id = :user_id`)
	if err != nil {
		return fmt.Errorf("read statement allocations for deletion: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id, statementID, transactionID string
		if err := rows.Scan(&id, &statementID, &transactionID); err != nil {
			rows.Close()
			return err
		}
		accountID, _, valid := types.ParseDerivedStatementID(statementID)
		if transactions[transactionID] || (valid && accounts[accountID]) {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(`DELETE FROM statement_allocation_events WHERE allocation_id = ? AND user_id = :user_id`, id); err != nil {
			return fmt.Errorf("delete statement allocation events %s: %w", id, err)
		}
		if _, err := tx.Exec(`DELETE FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id); err != nil {
			return fmt.Errorf("delete statement allocation %s: %w", id, err)
		}
		if err := releaseRowID(tx, id); err != nil {
			return err
		}
	}
	return nil
}
