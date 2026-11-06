// Account supersede merges one manual account into a bank-linked synced
// account. The synced account keeps its bridge link, bank checkpoints, and
// bank transactions: those are the authoritative facts. The manual account's
// profile and account-scoped configuration move to the synced account, then
// the manual account and its history are deleted in one transaction.
package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

var errSupersedeValidation = errors.New("account supersede validation rejected the candidate")

// SupersedeAccount retires manualID in favor of syncedID. The manual account
// must not already carry bank checkpoints or a bridge link. The synced account
// must already be linked to a bridge. The result reports validation issues
// with Persisted false and leaves the stored model unchanged when the
// candidate is invalid.
func (s *sqliteStore) SupersedeAccount(manualID, syncedID, bridgeID string) (store.AccountSupersedeResult, error) {
	var result store.AccountSupersedeResult
	if manualID == "" || syncedID == "" || bridgeID == "" || manualID == syncedID {
		return result, fmt.Errorf("%w: choose two different accounts", store.ErrAccountSupersedeInvalid)
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		baseline, err := loadModel(tx)
		if err != nil {
			return err
		}
		if baseline == nil {
			return store.NotFound(manualID)
		}
		manual, ok := supersedeFindAccount(baseline, manualID)
		if !ok {
			return store.NotFound(manualID)
		}
		synced, ok := supersedeFindAccount(baseline, syncedID)
		if !ok {
			return store.NotFound(syncedID)
		}
		if err := supersedeCheckPreconditions(tx, baseline, manual, synced, bridgeID); err != nil {
			return err
		}
		deletedTransactionIDs := supersedeTransactionsTouching(baseline, manualID)
		deletedTransactionSet := stringSet(deletedTransactionIDs)
		deletedScheduleIDs, err := supersedeRules(tx, baseline, manualID, syncedID)
		if err != nil {
			return err
		}
		deletedRuleSet := stringSet(deletedScheduleIDs)
		if err := supersedeAccountProfile(tx, manual, syncedID); err != nil {
			return err
		}
		if err := supersedeDeleteTransactions(tx, deletedTransactionIDs); err != nil {
			return err
		}
		if err := supersedeTransactionAmounts(tx, baseline, deletedTransactionSet, manualID, syncedID); err != nil {
			return err
		}
		if err := supersedeRuleAmounts(tx, baseline, deletedRuleSet, manualID, syncedID); err != nil {
			return err
		}
		if err := supersedeDeleteCheckpoints(tx, manualID); err != nil {
			return err
		}
		if err := supersedePlannedPurchases(tx, manualID, syncedID); err != nil {
			return err
		}
		if err := supersedePaymentTerms(tx, baseline, manualID, syncedID); err != nil {
			return err
		}
		if err := supersedeEvaluations(tx, manualID, syncedID, deletedTransactionSet, deletedRuleSet); err != nil {
			return err
		}
		if err := supersedeSafeSpending(tx, manualID, syncedID, deletedTransactionSet, deletedRuleSet); err != nil {
			return err
		}
		if err := supersedeSyncCards(tx, manualID, syncedID); err != nil {
			return err
		}
		if err := replaceSharingPolicyAccount(tx, manualID, syncedID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM accounts WHERE id = ? AND user_id = :user_id`, manualID); err != nil {
			return fmt.Errorf("delete superseded account %s: %w", manualID, err)
		}
		if err := releaseRowID(tx, manualID); err != nil {
			return err
		}
		candidate, err := loadModel(tx)
		if err != nil {
			return err
		}
		if candidate == nil {
			return fmt.Errorf("supersede account %s: model disappeared", manualID)
		}
		issues := domain.ValidateFinanceWriteChange(domain.EvaluationReferenceIssues(baseline), candidate)
		result.Issues = issues
		if supersedeHasErrors(issues) {
			result.Persisted = false
			return errSupersedeValidation
		}
		for _, account := range candidate.Accounts {
			if account.ID == syncedID {
				result.SyncedAccount = account
				break
			}
		}
		result.Persisted = true
		return nil
	})
	if errors.Is(err, errSupersedeValidation) {
		return result, nil
	}
	if err != nil {
		return store.AccountSupersedeResult{}, err
	}
	if err := s.markDirtyStart(); err != nil {
		return result, err
	}
	return result, nil
}

func supersedeFindAccount(model *types.FinancialModel, id string) (types.Account, bool) {
	for _, account := range model.Accounts {
		if account.ID == id {
			return account, true
		}
	}
	return types.Account{}, false
}

func supersedeCheckPreconditions(tx *userTx, model *types.FinancialModel, manual, synced types.Account, bridgeID string) error {
	// Only owner-authored rows are retired. Empty and provider sources both
	// belong to bank sync and must fail closed rather than lose bank facts.
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.AccountID == manual.ID && checkpoint.Source != store.SourceUser {
			return fmt.Errorf("%w: %s already has bank history", store.ErrAccountSupersedeInvalid, manual.Name)
		}
	}
	for _, transaction := range model.Transactions {
		if supersedeTransactionTouches(transaction, manual.ID) && transaction.Source != store.SourceUser {
			return fmt.Errorf("%w: %s still has bank transactions", store.ErrAccountSupersedeInvalid, manual.Name)
		}
	}
	manualLinks, err := supersedeLinkCount(tx, manual.ID)
	if err != nil {
		return err
	}
	if manualLinks > 0 {
		return fmt.Errorf("%w: %s is already linked to a bank account", store.ErrAccountSupersedeInvalid, manual.Name)
	}
	var exactLink int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM account_links WHERE bridge_account_id = ? AND model_account_id = ? AND user_id = :user_id`,
		bridgeID, synced.ID).Scan(&exactLink); err != nil {
		return fmt.Errorf("read exact bridge link %s: %w", bridgeID, err)
	}
	if exactLink == 0 {
		return fmt.Errorf("%w: the bridge link changed; reload and retry", store.ErrAccountSupersedeInvalid)
	}
	return nil
}

func supersedeLinkCount(tx *userTx, accountID string) (int, error) {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM account_links WHERE model_account_id = ? AND user_id = :user_id`, accountID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count account links for %s: %w", accountID, err)
	}
	return count, nil
}

func supersedeAccountProfile(tx *userTx, manual types.Account, syncedID string) error {
	var position int
	if err := tx.QueryRow(`SELECT position FROM accounts WHERE id = ? AND user_id = :user_id`, manual.ID).Scan(&position); err != nil {
		if err == sql.ErrNoRows {
			return store.NotFound(manual.ID)
		}
		return fmt.Errorf("read account position %s: %w", manual.ID, err)
	}
	if _, err := tx.Exec(
		`UPDATE accounts SET name = ?, kind = ?, min_balance = ?, max_balance = ?, color = ?, position = ? WHERE id = ? AND user_id = :user_id`,
		manual.Name, string(manual.Kind), valueOr(manual.MinBalance, types.NoFloor), valueOr(manual.MaxBalance, types.NoCeiling), nullable(manual.Color), position, syncedID,
	); err != nil {
		return fmt.Errorf("move account profile %s to %s: %w", manual.ID, syncedID, err)
	}
	return nil
}

func supersedeTransactionsTouching(model *types.FinancialModel, accountID string) []string {
	var ids []string
	for _, transaction := range model.Transactions {
		if supersedeTransactionTouches(transaction, accountID) {
			ids = append(ids, transaction.ID)
		}
	}
	return ids
}

func supersedeTransactionTouches(transaction types.Transaction, accountID string) bool {
	if transaction.SourceAccountID != nil && *transaction.SourceAccountID == accountID {
		return true
	}
	return supersedeContains(transaction.Destinations, accountID)
}

func supersedeDeleteTransactions(tx *userTx, transactionIDs []string) error {
	if len(transactionIDs) == 0 {
		return nil
	}
	now := time.Now().Unix()
	if err := ensureSuppressionSchema(tx); err != nil {
		return err
	}
	for _, id := range transactionIDs {
		if err := deleteSharingForTransaction(tx, id); err != nil {
			return err
		}
		if err := suppressTransactionKeys(tx, id, now); err != nil {
			return fmt.Errorf("suppress transaction keys %s: %w", id, err)
		}
		result, err := tx.Exec(`DELETE FROM transactions WHERE id = ? AND user_id = :user_id`, id)
		if err != nil {
			return fmt.Errorf("delete transaction %s: %w", id, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected > 0 {
			if err := releaseRowID(tx, id); err != nil {
				return err
			}
		}
	}
	return nil
}

func supersedeDeleteCheckpoints(tx *userTx, accountID string) error {
	if _, err := tx.Exec(`DELETE FROM checkpoint_available_balances WHERE model_account_id = ? AND user_id = :user_id`, accountID); err != nil {
		return fmt.Errorf("delete available balances for %s: %w", accountID, err)
	}
	if _, err := tx.Exec(`DELETE FROM checkpoints WHERE model_account_id = ? AND user_id = :user_id`, accountID); err != nil {
		return fmt.Errorf("delete checkpoints for %s: %w", accountID, err)
	}
	return nil
}

// supersedeTransactionAmounts rewrites provider argument references on owner and
// bank transactions that survive the merge. The expression's input names stay
// untouched because they are local variables, not account IDs.
func supersedeRules(tx *userTx, model *types.FinancialModel, manualID, syncedID string) ([]string, error) {
	var deleted []string
	for _, rule := range model.Schedules {
		if !supersedeRuleTouches(rule, manualID) {
			continue
		}
		source := rule.SourceAccountID
		if source != nil && *source == manualID {
			replacement := syncedID
			source = &replacement
		}
		destinations := supersedeReplaceIDs(rule.Destinations, manualID, syncedID)
		if source != nil && supersedeContains(destinations, *source) {
			if err := supersedeDeleteSchedule(tx, rule.ID); err != nil {
				return nil, err
			}
			deleted = append(deleted, rule.ID)
			continue
		}
		destinationsJSON := []byte("null")
		if destinations != nil {
			encoded, err := json.Marshal(destinations)
			if err != nil {
				return nil, fmt.Errorf("marshal rule destinations %s: %w", rule.ID, err)
			}
			destinationsJSON = encoded
		}
		if _, err := tx.Exec(`UPDATE recurrence_rules SET source_account_id = ?, destinations = ? WHERE id = ? AND user_id = :user_id`,
			nullable(source), string(destinationsJSON), rule.ID); err != nil {
			return nil, fmt.Errorf("move rule route %s: %w", rule.ID, err)
		}
	}
	return deleted, nil
}

func supersedeDeleteSchedule(tx *userTx, ruleID string) error {
	if _, err := tx.Exec(`DELETE FROM transaction_claims WHERE fulfills_rule_id = ? AND user_id = :user_id`, ruleID); err != nil {
		return fmt.Errorf("delete claims for rule %s: %w", ruleID, err)
	}
	if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, ruleID); err != nil {
		return fmt.Errorf("delete rule %s: %w", ruleID, err)
	}
	return releaseRowID(tx, ruleID)
}

func supersedeRuleTouches(rule types.Schedule, accountID string) bool {
	if rule.SourceAccountID != nil && *rule.SourceAccountID == accountID {
		return true
	}
	return supersedeContains(rule.Destinations, accountID)
}

func supersedePlannedPurchases(tx *userTx, manualID, syncedID string) error {
	if _, err := tx.Exec(`UPDATE planned_purchases SET funding_account_id = ? WHERE funding_account_id = ? AND user_id = :user_id`, syncedID, manualID); err != nil {
		return fmt.Errorf("move planned purchases from %s: %w", manualID, err)
	}
	return nil
}

func supersedePaymentTerms(tx *userTx, model *types.FinancialModel, manualID, syncedID string) error {
	hasManual := false
	hasSynced := false
	for _, terms := range model.PaymentTerms {
		if terms.AccountID == manualID {
			hasManual = true
		}
		if terms.AccountID == syncedID {
			hasSynced = true
		}
	}
	if !hasManual {
		return nil
	}
	if hasSynced {
		return fmt.Errorf("%w: the synced account already has payment terms", store.ErrAccountSupersedeInvalid)
	}
	if _, err := tx.Exec(`UPDATE payment_terms SET model_account_id = ? WHERE model_account_id = ? AND user_id = :user_id`, syncedID, manualID); err != nil {
		return fmt.Errorf("move payment terms from %s: %w", manualID, err)
	}
	return nil
}

func supersedeReplaceIDs(ids []string, oldID, newID string) []string {
	if ids == nil {
		return nil
	}
	out := make([]string, 0, len(ids))
	seen := map[string]bool{}
	replaced := false
	for _, id := range ids {
		if id == oldID {
			id = newID
			replaced = true
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	if !replaced {
		return ids
	}
	if len(out) == 0 {
		return []string{}
	}
	return out
}

func supersedeRemoveIDs(ids []string, removed map[string]bool) []string {
	if ids == nil {
		return nil
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if removed[id] {
			continue
		}
		out = append(out, id)
	}
	if len(out) == 0 {
		return []string{}
	}
	return out
}

func supersedeContains(ids []string, target string) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

func stringSet(ids []string) map[string]bool {
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func supersedeHasErrors(issues []types.ModelValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			return true
		}
	}
	return false
}

// replaceSharingPolicyAccount moves one deleted manual account's automatic
// sharing selection to its synced replacement. The policy version bumps so
// stale generations fence immediately, the visibility index re-derives at the
// new version, and one audit row per touched policy records the substitution.
// A policy that already lists the synced account keeps one entry.
