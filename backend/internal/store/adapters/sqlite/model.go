package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func deleteModelRows(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM planned_purchases WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM accounts WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM checkpoint_available_balances WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM checkpoints WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM transactions WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM evaluations WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM payment_terms WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pinned_evaluations WHERE user_id = :user_id`); err != nil {
		return err
	}
	// Model replacement invalidates explicit consent for the replaced rows:
	// post-import IDs are new rows, and old grants must not attach to them.
	if err := clearSharingForUser(tx); err != nil {
		return err
	}
	// Splits name source transactions by ID, so replacement drops them
	// alongside consent: a split must never attach to an unrelated new row.
	if err := clearSplitsForUser(tx); err != nil {
		return err
	}
	return nil
}

func clearModel(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM analysis_findings WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM analysis_runs WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM analysis_promotions WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM safe_spending_settings WHERE user_id = :user_id`); err != nil {
		return err
	}
	if err := deleteModelRows(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear entity ids: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM account_links WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear account links: %w", err)
	}
	if _, err := tx.Exec(`UPDATE sync_state SET last_sync_at = '' WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sync state: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM sync_credentials WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sync credentials: %w", err)
	}
	if _, err := tx.Exec(gmailCredentialsDDL); err != nil {
		return fmt.Errorf("clear ensure gmail credentials: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM gmail_credentials WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear gmail credentials: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM email_receipts WHERE user_id = :user_id`); err != nil {
		return fmt.Errorf("clear email receipts: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM monte_carlo_statistics WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM projection_slices WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM projection_rows WHERE user_id = :user_id`); err != nil {
		return err
	}
	for _, table := range []string{"net_worth_threshold_outputs", "account_balance_outputs", "transaction_fulfillment_outputs", "cycle_fulfillment_outputs", "planned_purchases_outputs", "financial_independence_outputs", "whatif_outputs"} {
		if _, err := tx.Exec(`DELETE FROM ` + table + ` WHERE user_id = :user_id`); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM projection_states WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM provider_connections WHERE user_id = :user_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE model_metadata SET source_path = '', document_present = 0 WHERE id = 1 AND user_id = :user_id`); err != nil {
		return fmt.Errorf("clear model metadata: %w", err)
	}
	return nil
}

// replaceModel is the seed/import path: it wholesale replaces owner
// rows while preserving sync-owned rows. Runtime writes use row CRUD.
func replaceModel(tx *userTx, model *types.FinancialModel) error {
	restoreAnalysis, err := preserveAnalysisEvidence(tx)
	if err != nil {
		return err
	}
	// Invariant: bank lines survive your saves. Sync-owned rows are managed
	// only by the sync, never by seed payloads: snapshot them, ignore
	// incoming copies of those identities, then re-merge. Incoming
	// owner checkpoints win key collisions, so owners always keep an override
	// path. Accounts referenced only by sync rows are preserved so history
	// never orphans.
	syncedCheckpoints, err := loadSyncedCheckpoints(tx)
	if err != nil {
		return err
	}
	syncedTransactions, err := loadSyncedTransactions(tx)
	if err != nil {
		return err
	}
	// Receipts can attach to settled bank rows, so evidence for preserved
	// rows is snapshotted here and restored after the re-merge; row
	// deletion would otherwise cascade to it.
	bankReceipts, err := loadReceiptsForTransactions(tx, bankTransactionIDs(syncedTransactions))
	if err != nil {
		return err
	}
	syncKeys, err := loadTransactionSyncKeys(tx)
	if err != nil {
		return err
	}
	storedModel, err := loadModel(tx)
	if err != nil {
		return err
	}
	accounts := append([]types.Account(nil), model.Accounts...)
	accountIDs := make(map[string]struct{}, len(accounts))
	for _, account := range accounts {
		accountIDs[account.ID] = struct{}{}
	}
	storedByID := make(map[string]types.Account, len(accounts))
	if storedModel != nil {
		for _, account := range storedModel.Accounts {
			if _, ok := storedByID[account.ID]; !ok {
				storedByID[account.ID] = account
			}
		}
	}
	preserveAccount := func(id string) {
		if _, ok := accountIDs[id]; ok || storedModel == nil {
			return
		}
		if account, ok := storedByID[id]; ok {
			accounts = append(accounts, account)
			accountIDs[id] = struct{}{}
		}
	}
	for _, checkpoint := range syncedCheckpoints {
		preserveAccount(checkpoint.AccountID)
	}
	for _, transaction := range syncedTransactions {
		if transaction.SourceAccountID != nil {
			preserveAccount(*transaction.SourceAccountID)
		}
		for _, destinationID := range transaction.Destinations {
			preserveAccount(destinationID)
		}
	}
	if err := deleteModelRows(tx); err != nil {
		return err
	}

	position := 0
	for _, account := range accounts {
		minBalance := valueOr(account.MinBalance, types.NoFloor)
		maxBalance := valueOr(account.MaxBalance, types.NoCeiling)
		color := nullable(account.Color)
		if _, err := tx.Exec(
			`INSERT INTO accounts (id, position, name, kind, min_balance, max_balance, color, enabled, user_id) VALUES (?,?,?,?,?,?,?,?, :user_id)`,
			account.ID, position, account.Name, string(account.Kind), minBalance, maxBalance, color, boolToInt(account.Enabled),
		); err != nil {
			return fmt.Errorf("insert account %s: %w", account.ID, err)
		}
		position++
	}
	if _, err := remergeCheckpoints(tx, model.Checkpoints, syncedCheckpoints, 0); err != nil {
		return err
	}
	if _, err := remergeTransactions(tx, model.Transactions, syncedTransactions, 0); err != nil {
		return err
	}
	for position, purchase := range model.PlannedPurchases {
		if err := insertPlannedPurchase(tx, position, purchase); err != nil {
			return err
		}
	}
	for _, key := range syncKeys {
		if err := insertTransactionSyncKey(tx, key); err != nil {
			return err
		}
	}
	if err := restoreReceipts(tx, bankReceipts); err != nil {
		return err
	}
	if err := restoreAnalysis(); err != nil {
		return err
	}
	position = 0
	for _, rule := range model.Schedules {
		if err := insertRule(tx, position, &rule); err != nil {
			return err
		}
		position++
	}
	for _, table := range model.Evaluations.Tables() {
		if err := saveEvaluationTable(tx, table.Type, evaluationRowsOf(*table.Rows)); err != nil {
			return err
		}
	}
	if err := savePaymentTerms(tx, model.PaymentTerms); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE model_metadata SET source_path = ?, document_present = 1 WHERE id = 1 AND user_id = :user_id`,
		model.SourcePath,
	); err != nil {
		return fmt.Errorf("save model metadata: %w", err)
	}
	return nil
}

// transactionSelect lists the columns that build a types.Transaction: core fields
// from transactions, order/enabled/execution state from transaction_sim, and the
// optional claim from transaction_claims. Every transactions read that builds a
// wire Transaction must use this fragment with transactionJoins so all three stay
// in sync. types.Transaction.Destinations keeps its wire name; it reads from
// the destination_account_ids column.
const transactionSelect = `p.id, p.name, p.source_account_id, p.destination_account_ids, p.amount_resolution_json, p.posted_time, p.transaction_time, c.fulfills_rule_id, c.fulfills_occurrence_date, s.enabled, p.source, p.pending, p.void, s.execution_order`

// transactionJoins attaches the transaction satellites to a transactions alias p.
const transactionJoins = `FROM transactions p LEFT JOIN transaction_sim s ON s.user_id = p.user_id AND s.transaction_id = p.id LEFT JOIN transaction_claims c ON c.user_id = p.user_id AND c.transaction_id = p.id`

func insertTransaction(tx *userTx, position int, transaction *types.Transaction, source string) error {
	if transaction.ExecutionOrder == 0 {
		if err := tx.QueryRow(`SELECT COALESCE(MAX(execution_order), 0) + 1 FROM transaction_sim WHERE user_id = :user_id`).Scan(&transaction.ExecutionOrder); err != nil {
			return fmt.Errorf("allocate transaction execution order: %w", err)
		}
	}
	destinationsJSON := []byte("null")
	if transaction.Destinations != nil {
		var err error
		destinationsJSON, err = json.Marshal(transaction.Destinations)
		if err != nil {
			return fmt.Errorf("marshal destinations %s: %w", transaction.ID, err)
		}
	}
	amountJSON, err := json.Marshal(transaction.Amount)
	if err != nil {
		return fmt.Errorf("marshal amount %s: %w", transaction.ID, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?, :user_id)`,
		transaction.ID, transaction.Name, nullable(transaction.SourceAccountID), string(destinationsJSON), string(amountJSON),
		transaction.PostedTime, transaction.TransactionTime, source, boolToInt(source != SourceUser && transaction.Pending), boolToInt(transaction.Void),
	); err != nil {
		return fmt.Errorf("insert transaction %s: %w", transaction.ID, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id) VALUES (?, ?, ?, ?, :user_id)`,
		transaction.ID, position, boolToInt(transaction.Enabled), transaction.ExecutionOrder,
	); err != nil {
		return fmt.Errorf("insert transaction sim %s: %w", transaction.ID, err)
	}
	if transaction.Claim != nil {
		if _, err := tx.Exec(
			`INSERT INTO transaction_claims (transaction_id, fulfills_rule_id, fulfills_occurrence_date, user_id) VALUES (?, ?, ?, :user_id)`,
			transaction.ID, transaction.Claim.ScheduleID, transaction.Claim.OccurrenceDate,
		); err != nil {
			return fmt.Errorf("insert transaction claim %s: %w", transaction.ID, err)
		}
	}
	// Group-share discovery stays consistent in the same write: every
	// insert path (owner create, rule conversion, bank sync, seed import)
	// funnels here, so late-imported and backdated rows qualify exactly
	// like pre-existing ones with no extra review step.
	return refreshVisibilityForTransactionTx(tx, transaction.ID)
}

func insertRule(tx *userTx, position int, rule *types.Schedule) error {
	destinationsJSON := []byte("null")
	if rule.Destinations != nil {
		var err error
		destinationsJSON, err = json.Marshal(rule.Destinations)
		if err != nil {
			return fmt.Errorf("marshal rule destinations %s: %w", rule.ID, err)
		}
	}
	amountJSON, err := json.Marshal(rule.Amount)
	if err != nil {
		return fmt.Errorf("marshal rule amount %s: %w", rule.ID, err)
	}
	sourceAccountID := nullable(rule.SourceAccountID)
	endDate := nullable(rule.EndDate)
	annualCap := nullable(rule.AnnualCap)
	if _, err := tx.Exec(
		`INSERT INTO recurrence_rules (id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled, user_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?, :user_id)`,
		rule.ID, position, rule.Name, sourceAccountID, string(destinationsJSON), string(amountJSON),
		string(rule.Frequency),
		rule.StartDate, endDate, annualCap, rule.Priority, boolToInt(rule.Enabled),
	); err != nil {
		return fmt.Errorf("insert recurrence rule %s: %w", rule.ID, err)
	}
	return nil
}

func savePaymentTerms(tx *userTx, terms []types.PaymentTerms) error {
	for position, term := range terms {
		minimumPercent := nullable(term.MinimumPercent)
		statementDay := nullable(term.StatementDay)
		if _, err := tx.Exec(
			`INSERT INTO payment_terms (model_account_id, position, minimum_fixed, minimum_percent, due_day, statement_day, user_id) VALUES (?,?,?,?,?,?, :user_id)`,
			term.AccountID, position, term.MinimumFixed, minimumPercent, term.DueDay, statementDay,
		); err != nil {
			return fmt.Errorf("insert payment terms %s: %w", term.AccountID, err)
		}
	}
	return nil
}

func scanCheckpointRow(rows *sql.Rows) (types.Checkpoint, error) {
	var checkpoint types.Checkpoint
	var available sql.NullFloat64
	if err := rows.Scan(&checkpoint.AccountID, &checkpoint.Balance, &checkpoint.Source, &checkpoint.ObservedAt, &available); err != nil {
		return types.Checkpoint{}, err
	}
	checkpoint.AvailableBalance = scanAvailableBalance(available)
	return checkpoint, nil
}

func scanTransactionRow(rows *sql.Rows) (types.Transaction, error) {
	// Receipt links live in the receipts table now; scanTransactionRow only
	// assembles the wire Transaction from transactions plus its sim and claim
	// satellites. Callers must select transactionSelect with transactionJoins so
	// the column order below holds.
	var transaction types.Transaction
	var sourceAccountID, claimScheduleID, claimOccurrenceDate sql.NullString
	var destinationsJSON, amountJSON string
	var enabled, executionOrder sql.NullInt64
	var pending, voided int64
	var source sql.NullString
	if err := rows.Scan(&transaction.ID, &transaction.Name, &sourceAccountID, &destinationsJSON, &amountJSON, &transaction.PostedTime, &transaction.TransactionTime, &claimScheduleID, &claimOccurrenceDate, &enabled, &source, &pending, &voided, &executionOrder); err != nil {
		return types.Transaction{}, err
	}
	if sourceAccountID.Valid {
		value := sourceAccountID.String
		transaction.SourceAccountID = &value
	}
	if destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &transaction.Destinations); err != nil {
			return types.Transaction{}, fmt.Errorf("parse destinations %s: %w", transaction.ID, err)
		}
	} else {
		transaction.Destinations = nil
	}
	if err := json.Unmarshal([]byte(amountJSON), &transaction.Amount); err != nil {
		return types.Transaction{}, fmt.Errorf("parse amount %s: %w", transaction.ID, err)
	}
	if claimScheduleID.Valid && claimOccurrenceDate.Valid {
		transaction.Claim = &types.TransactionClaim{ScheduleID: claimScheduleID.String, OccurrenceDate: claimOccurrenceDate.String}
	}
	transaction.Enabled = enabled.Valid && enabled.Int64 != 0
	transaction.Pending = pending != 0
	transaction.Void = voided != 0
	if executionOrder.Valid {
		transaction.ExecutionOrder = executionOrder.Int64
	}
	if source.Valid {
		transaction.Source = source.String
	}
	return transaction, nil
}

func scanRuleRow(rows *sql.Rows) (types.Schedule, error) {
	var rule types.Schedule
	var sourceAccountID, endDate sql.NullString
	var destinationsJSON, amountJSON string
	var frequency string
	var enabled int64
	var capNull sql.NullFloat64
	if err := rows.Scan(&rule.ID, &rule.Name, &sourceAccountID, &destinationsJSON, &amountJSON, &frequency, &rule.StartDate, &endDate, &capNull, &rule.Priority, &enabled); err != nil {
		return types.Schedule{}, err
	}
	if sourceAccountID.Valid {
		value := sourceAccountID.String
		rule.SourceAccountID = &value
	}
	if destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &rule.Destinations); err != nil {
			return types.Schedule{}, fmt.Errorf("parse rule destinations %s: %w", rule.ID, err)
		}
	} else {
		rule.Destinations = nil
	}
	if err := json.Unmarshal([]byte(amountJSON), &rule.Amount); err != nil {
		return types.Schedule{}, fmt.Errorf("parse rule amount %s: %w", rule.ID, err)
	}
	rule.Frequency = types.Frequency(frequency)
	if endDate.Valid {
		value := endDate.String
		rule.EndDate = &value
	}
	if capNull.Valid {
		value := capNull.Float64
		rule.AnnualCap = &value
	}
	rule.Enabled = enabled != 0
	return rule, nil
}

func evaluationRowsOf(items []types.EvaluationInstance[types.JsonValue]) []evaluationRow {
	rows := make([]evaluationRow, 0, len(items))
	for position, item := range items {
		rows = append(rows, evaluationRow{instanceID: item.InstanceID, position: position, name: item.Name, enabled: item.Enabled, configValue: item.Config})
	}
	return rows
}

type evaluationRow struct {
	instanceID  string
	position    int
	name        string
	enabled     bool
	configValue types.JsonValue
}

func saveEvaluationTable(tx *userTx, evaluationType string, rows []evaluationRow) error {
	for _, row := range rows {
		configJSON, err := json.Marshal(row.configValue)
		if err != nil {
			return fmt.Errorf("marshal config %s: %w", row.instanceID, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json, user_id) VALUES (?,?,?,?,?,?, :user_id)`,
			evaluationType, row.instanceID, row.position, row.name, boolToInt(row.enabled), string(configJSON),
		); err != nil {
			return fmt.Errorf("insert evaluation %s: %w", row.instanceID, err)
		}
	}
	return nil
}

// LoadModel reads the canonical model; returns nil if absent.
func (s *sqliteStore) LoadModel() (*types.FinancialModel, error) {
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("load model begin: %w", err)
	}
	defer tx.Rollback()
	model, err := loadModel(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("load model commit: %w", err)
	}
	return model, nil
}

func loadModel(q queryer) (*types.FinancialModel, error) {
	var sourcePath string
	var modelPresent int
	if err := q.QueryRow(`SELECT source_path, document_present FROM model_metadata WHERE id = 1 AND user_id = :user_id`).Scan(&sourcePath, &modelPresent); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load model metadata: %w", err)
	}
	if modelPresent == 0 {
		return nil, nil
	}
	model := &types.FinancialModel{
		SourcePath:  sourcePath,
		Evaluations: types.EmptyEvaluationTables(),
	}
	accountRows, err := q.Query(`SELECT id, name, kind, min_balance, max_balance, color, enabled FROM accounts WHERE user_id = :user_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer accountRows.Close()
	for accountRows.Next() {
		var account types.Account
		var kind string
		var minBalance, maxBalance sql.NullFloat64
		var color sql.NullString
		var enabled int64
		if err := accountRows.Scan(&account.ID, &account.Name, &kind, &minBalance, &maxBalance, &color, &enabled); err != nil {
			return nil, err
		}
		account.Kind = types.AccountKind(kind)
		if minBalance.Valid {
			value := minBalance.Float64
			account.MinBalance = &value
		} else {
			value := types.NoFloor
			account.MinBalance = &value
		}
		if maxBalance.Valid {
			value := maxBalance.Float64
			account.MaxBalance = &value
		} else {
			value := types.NoCeiling
			account.MaxBalance = &value
		}
		if color.Valid {
			value := color.String
			account.Color = &value
		}
		account.Enabled = enabled != 0
		model.Accounts = append(model.Accounts, account)
	}
	if err := accountRows.Err(); err != nil {
		accountRows.Close()
		return nil, fmt.Errorf("iterate accounts: %w", err)
	}
	if err := accountRows.Close(); err != nil {
		return nil, fmt.Errorf("close accounts: %w", err)
	}

	checkpointQuery := `SELECT c.model_account_id, c.balance, c.source, c.observed_at, NULL FROM checkpoints c WHERE c.user_id = :user_id ORDER BY c.position`
	var availableTables int
	if err := q.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'checkpoint_available_balances'`).Scan(&availableTables); err != nil {
		return nil, err
	}
	if availableTables == 1 {
		checkpointQuery = `SELECT c.model_account_id, c.balance, c.source, c.observed_at, a.available_balance
			FROM checkpoints c LEFT JOIN checkpoint_available_balances a
			ON a.user_id = c.user_id AND a.model_account_id = c.model_account_id AND a.observed_at = c.observed_at
			WHERE c.user_id = :user_id ORDER BY c.position`
	}
	checkpointRows, err := q.Query(checkpointQuery)
	if err != nil {
		return nil, err
	}
	defer checkpointRows.Close()
	for checkpointRows.Next() {
		checkpoint, err := scanCheckpointRow(checkpointRows)
		if err != nil {
			return nil, err
		}
		model.Checkpoints = append(model.Checkpoints, checkpoint)
	}
	if err := checkpointRows.Err(); err != nil {
		checkpointRows.Close()
		return nil, fmt.Errorf("iterate checkpoints: %w", err)
	}
	if err := checkpointRows.Close(); err != nil {
		return nil, fmt.Errorf("close checkpoints: %w", err)
	}

	transactionRows, err := q.Query(`SELECT ` + transactionSelect + ` ` + transactionJoins + ` WHERE p.user_id = :user_id AND p.projection_slice_id IS NULL ORDER BY s.position`)
	if err != nil {
		return nil, err
	}
	defer transactionRows.Close()
	for transactionRows.Next() {
		transaction, err := scanTransactionRow(transactionRows)
		if err != nil {
			return nil, err
		}
		model.Transactions = append(model.Transactions, transaction)
	}
	if err := transactionRows.Err(); err != nil {
		transactionRows.Close()
		return nil, fmt.Errorf("iterate transactions: %w", err)
	}
	if err := transactionRows.Close(); err != nil {
		return nil, fmt.Errorf("close transactions: %w", err)
	}
	model.PlannedPurchases, err = loadPlannedPurchases(q)
	if err != nil {
		return nil, err
	}

	ruleRows, err := q.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled FROM recurrence_rules WHERE user_id = :user_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer ruleRows.Close()
	for ruleRows.Next() {
		rule, err := scanRuleRow(ruleRows)
		if err != nil {
			return nil, err
		}
		model.Schedules = append(model.Schedules, rule)
	}
	if err := ruleRows.Err(); err != nil {
		ruleRows.Close()
		return nil, fmt.Errorf("iterate recurrence rules: %w", err)
	}
	if err := ruleRows.Close(); err != nil {
		return nil, fmt.Errorf("close recurrence rules: %w", err)
	}

	evaluationRows, err := q.Query(`SELECT type, instance_id, name, enabled, config_json FROM evaluations WHERE user_id = :user_id ORDER BY type, position`)
	if err != nil {
		return nil, err
	}
	defer evaluationRows.Close()
	// Index the tables once: per-row ByType would rebuild the table list
	// for every stored evaluation.
	evaluationTables := map[string]*[]types.EvaluationInstance[types.JsonValue]{}
	for _, table := range model.Evaluations.Tables() {
		evaluationTables[table.Type] = table.Rows
	}
	for evaluationRows.Next() {
		var evaluationType, instanceID, name, configJSON string
		var enabled int64
		if err := evaluationRows.Scan(&evaluationType, &instanceID, &name, &enabled, &configJSON); err != nil {
			return nil, err
		}
		if rows := evaluationTables[evaluationType]; rows != nil {
			config := map[string]any{}
			if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
				return nil, fmt.Errorf("parse %s config %s: %w", evaluationType, instanceID, err)
			}
			*rows = append(*rows, types.EvaluationInstance[types.JsonValue]{
				InstanceID: instanceID, Name: name, Enabled: enabled != 0, Config: config,
			})
		}
	}
	if err := evaluationRows.Err(); err != nil {
		evaluationRows.Close()
		return nil, fmt.Errorf("iterate evaluations: %w", err)
	}
	if err := evaluationRows.Close(); err != nil {
		return nil, fmt.Errorf("close evaluations: %w", err)
	}

	termRows, err := q.Query(`SELECT model_account_id, minimum_fixed, minimum_percent, due_day, statement_day FROM payment_terms WHERE user_id = :user_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer termRows.Close()
	for termRows.Next() {
		var term types.PaymentTerms
		var minimumPercent sql.NullFloat64
		var statementDay sql.NullInt64
		if err := termRows.Scan(&term.AccountID, &term.MinimumFixed, &minimumPercent, &term.DueDay, &statementDay); err != nil {
			return nil, err
		}
		if minimumPercent.Valid {
			value := minimumPercent.Float64
			term.MinimumPercent = &value
		}
		if statementDay.Valid {
			value := int(statementDay.Int64)
			term.StatementDay = &value
		}
		model.PaymentTerms = append(model.PaymentTerms, term)
	}
	if err := termRows.Err(); err != nil {
		termRows.Close()
		return nil, fmt.Errorf("iterate payment terms: %w", err)
	}
	if err := termRows.Close(); err != nil {
		return nil, fmt.Errorf("close payment terms: %w", err)
	}

	if model.Accounts == nil {
		model.Accounts = []types.Account{}
	}
	if model.Checkpoints == nil {
		model.Checkpoints = []types.Checkpoint{}
	}
	if model.Transactions == nil {
		model.Transactions = []types.Transaction{}
	}
	if model.Schedules == nil {
		model.Schedules = []types.Schedule{}
	}
	if model.PaymentTerms == nil {
		model.PaymentTerms = []types.PaymentTerms{}
	}
	return model, nil
}

// ModelExists reports whether any canonical rows are present.
func (s *sqliteStore) ModelExists() (bool, error) {
	var present int
	row := s.db.QueryRow(`SELECT document_present FROM model_metadata WHERE id = 1 AND user_id = :user_id`)
	if err := row.Scan(&present); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return present != 0, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// nullable maps a pointer to a SQL nullable argument: nil becomes NULL.
func nullable[T any](ptr *T) any {
	if ptr == nil {
		return nil
	}
	return *ptr
}

// valueOr returns the pointed-to value or the fallback (for sentinel columns
// that never store NULL, such as account bounds).
func valueOr[T any](ptr *T, fallback T) T {
	if ptr == nil {
		return fallback
	}
	return *ptr
}
