package store

import (
	"context"
	"crypto/sha256"
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

// DocumentETag returns a content identity for the canonical model document.
func DocumentETag(document *types.FinancialModelDocument) (string, error) {
	if document == nil {
		return `""`, nil
	}
	payload, err := json.Marshal(document)
	if err != nil {
		return "", fmt.Errorf("encode model ETag: %w", err)
	}
	digest := sha256.Sum256(payload)
	return fmt.Sprintf(`"sha256-%x"`, digest), nil
}

func deleteDocumentRows(tx *planTx) error {
	if _, err := tx.Exec(`DELETE FROM accounts WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM checkpoints WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM postings WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM evaluations WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM payment_terms WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pinned_evaluations WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	return nil
}

func clearDocument(tx *planTx) error {
	if _, err := tx.Exec(`DELETE FROM safe_spending_settings WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if err := deleteDocumentRows(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear entity ids: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM posting_id_migrations WHERE plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear posting id history: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM account_links WHERE plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear account links: %w", err)
	}
	if _, err := tx.Exec(`UPDATE sync_state SET last_sync_at = '' WHERE plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear sync state: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM sync_credentials WHERE plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear sync credentials: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM projection_artifacts WHERE plan_id = :plan_id`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE model_metadata SET source_path = '', document_present = 0 WHERE id = 1 AND plan_id = :plan_id`); err != nil {
		return fmt.Errorf("clear model metadata: %w", err)
	}
	return nil
}

// replaceDocument is the seed/import path: it wholesale replaces owner
// rows while preserving sync-owned rows. Runtime writes use row CRUD.
func replaceDocument(tx *planTx, document *types.FinancialModelDocument) error {
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
	syncedPostings, err := loadSyncedPostings(tx)
	if err != nil {
		return err
	}
	// Receipts can attach to settled bank rows, so evidence for preserved
	// rows is snapshotted here and restored after the re-merge; row
	// deletion would otherwise cascade to it.
	bankReceipts, err := loadReceiptsForPostings(tx, bankPostingIDs(syncedPostings))
	if err != nil {
		return err
	}
	syncKeys, err := loadPostingSyncKeys(tx)
	if err != nil {
		return err
	}
	storedDocument, err := loadDocument(tx)
	if err != nil {
		return err
	}
	accounts := append([]types.Account(nil), document.Accounts...)
	accountIDs := make(map[string]struct{}, len(accounts))
	for _, account := range accounts {
		accountIDs[account.ID] = struct{}{}
	}
	storedByID := make(map[string]types.Account, len(accounts))
	if storedDocument != nil {
		for _, account := range storedDocument.Accounts {
			if _, ok := storedByID[account.ID]; !ok {
				storedByID[account.ID] = account
			}
		}
	}
	preserveAccount := func(id string) {
		if _, ok := accountIDs[id]; ok || storedDocument == nil {
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
	for _, posting := range syncedPostings {
		if posting.SourceAccountID != nil {
			preserveAccount(*posting.SourceAccountID)
		}
		for _, destinationID := range posting.Destinations {
			preserveAccount(destinationID)
		}
	}
	if err := deleteDocumentRows(tx); err != nil {
		return err
	}

	position := 0
	for _, account := range accounts {
		minBalance := valueOr(account.MinBalance, types.NoFloor)
		maxBalance := valueOr(account.MaxBalance, types.NoCeiling)
		color := nullable(account.Color)
		if _, err := tx.Exec(
			`INSERT INTO accounts (id, position, name, kind, min_balance, max_balance, color, enabled, plan_id) VALUES (?,?,?,?,?,?,?,?, :plan_id)`,
			account.ID, position, account.Name, string(account.Kind), minBalance, maxBalance, color, boolToInt(account.Enabled),
		); err != nil {
			return fmt.Errorf("insert account %s: %w", account.ID, err)
		}
		position++
	}
	if _, err := remergeCheckpoints(tx, document.Checkpoints, syncedCheckpoints, 0); err != nil {
		return err
	}
	if _, err := remergePostings(tx, document.Postings, syncedPostings, 0); err != nil {
		return err
	}
	for _, key := range syncKeys {
		if err := insertPostingSyncKey(tx, key); err != nil {
			return err
		}
	}
	if err := restoreReceipts(tx, bankReceipts); err != nil {
		return err
	}
	position = 0
	for _, rule := range document.RecurrenceRules {
		if err := insertRule(tx, position, &rule); err != nil {
			return err
		}
		position++
	}
	for _, table := range document.Evaluations.Tables() {
		if err := saveEvaluationTable(tx, table.Type, evaluationRowsOf(*table.Rows)); err != nil {
			return err
		}
	}
	if err := savePaymentTerms(tx, document.PaymentTerms); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE model_metadata SET source_path = ?, document_present = 1 WHERE id = 1 AND plan_id = :plan_id`,
		document.SourcePath,
	); err != nil {
		return fmt.Errorf("save model metadata: %w", err)
	}
	return nil
}

func insertPosting(tx *planTx, position int, posting *types.Posting, source string) error {
	if posting.ExecutionOrder == 0 {
		if err := tx.QueryRow(`SELECT COALESCE(MAX(execution_order), 0) + 1 FROM postings WHERE plan_id = :plan_id`).Scan(&posting.ExecutionOrder); err != nil {
			return fmt.Errorf("allocate posting execution order: %w", err)
		}
	}
	destinationsJSON := []byte("null")
	if posting.Destinations != nil {
		var err error
		destinationsJSON, err = json.Marshal(posting.Destinations)
		if err != nil {
			return fmt.Errorf("marshal destinations %s: %w", posting.ID, err)
		}
	}
	amountJSON, err := json.Marshal(posting.Amount)
	if err != nil {
		return fmt.Errorf("marshal amount %s: %w", posting.ID, err)
	}
	var sourceAccountID, claimRuleID, claimOccurrenceDate any
	sourceAccountID = nullable(posting.SourceAccountID)
	if posting.Claim != nil {
		claimRuleID = posting.Claim.RuleID
		claimOccurrenceDate = posting.Claim.OccurrenceDate
	}
	if _, err := tx.Exec(
		`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, plan_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, :plan_id)`,
		posting.ID, position, posting.Name, sourceAccountID, string(destinationsJSON), string(amountJSON),
		posting.PostedTime, posting.TransactionTime, claimRuleID, claimOccurrenceDate, boolToInt(posting.Enabled), source, boolToInt(source != SourceModel && posting.Pending), boolToInt(posting.Void), posting.ExecutionOrder,
	); err != nil {
		return fmt.Errorf("insert posting %s: %w", posting.ID, err)
	}
	return insertPurchasePolicy(tx, posting)
}

func insertRule(tx *planTx, position int, rule *types.RecurrenceRule) error {
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
		`INSERT INTO recurrence_rules (id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled, plan_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?, :plan_id)`,
		rule.ID, position, rule.Name, sourceAccountID, string(destinationsJSON), string(amountJSON),
		string(rule.Frequency),
		rule.StartDate, endDate, annualCap, rule.Priority, boolToInt(rule.Enabled),
	); err != nil {
		return fmt.Errorf("insert recurrence rule %s: %w", rule.ID, err)
	}
	return nil
}

func savePaymentTerms(tx *planTx, terms []types.PaymentTerms) error {
	for position, term := range terms {
		minimumPercent := nullable(term.MinimumPercent)
		statementDay := nullable(term.StatementDay)
		if _, err := tx.Exec(
			`INSERT INTO payment_terms (account_id, position, minimum_fixed, minimum_percent, due_day, statement_day, plan_id) VALUES (?,?,?,?,?,?, :plan_id)`,
			term.AccountID, position, term.MinimumFixed, minimumPercent, term.DueDay, statementDay,
		); err != nil {
			return fmt.Errorf("insert payment terms %s: %w", term.AccountID, err)
		}
	}
	return nil
}

func scanCheckpointRow(rows *sql.Rows) (types.Checkpoint, error) {
	var checkpoint types.Checkpoint
	if err := rows.Scan(&checkpoint.Date, &checkpoint.AccountID, &checkpoint.Balance, &checkpoint.Source); err != nil {
		return types.Checkpoint{}, err
	}
	return checkpoint, nil
}

func scanPostingRow(rows *sql.Rows) (types.Posting, error) {
	// postings.receipt_ids is a storage-only back-reference. It is never
	// selected here, so it cannot enter FinancialModelDocument, financial
	// revisions, or projection identities; the API exposes it separately as
	// receiptLinks. Creation/deletion maintain it in the same transaction as
	// the receipt row (see addPostingReceiptID/removePostingReceiptID).
	var posting types.Posting
	var sourceAccountID, claimRuleID, claimOccurrenceDate sql.NullString
	var destinationsJSON, amountJSON string
	var enabled, pending, voided int64
	var source sql.NullString
	if err := rows.Scan(&posting.ID, &posting.Name, &sourceAccountID, &destinationsJSON, &amountJSON, &posting.PostedTime, &posting.TransactionTime, &claimRuleID, &claimOccurrenceDate, &enabled, &source, &pending, &voided, &posting.ExecutionOrder); err != nil {
		return types.Posting{}, err
	}
	if sourceAccountID.Valid {
		value := sourceAccountID.String
		posting.SourceAccountID = &value
	}
	if destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &posting.Destinations); err != nil {
			return types.Posting{}, fmt.Errorf("parse destinations %s: %w", posting.ID, err)
		}
	} else {
		posting.Destinations = nil
	}
	if err := json.Unmarshal([]byte(amountJSON), &posting.Amount); err != nil {
		return types.Posting{}, fmt.Errorf("parse amount %s: %w", posting.ID, err)
	}
	if claimRuleID.Valid && claimOccurrenceDate.Valid {
		posting.Claim = &types.PostingClaim{RuleID: claimRuleID.String, OccurrenceDate: claimOccurrenceDate.String}
	}
	posting.Enabled = enabled != 0
	posting.Pending = pending != 0
	posting.Void = voided != 0
	if source.Valid {
		posting.Source = source.String
	}
	return posting, nil
}

func scanRuleRow(rows *sql.Rows) (types.RecurrenceRule, error) {
	var rule types.RecurrenceRule
	var sourceAccountID, endDate sql.NullString
	var destinationsJSON, amountJSON string
	var frequency string
	var enabled int64
	var capNull sql.NullFloat64
	if err := rows.Scan(&rule.ID, &rule.Name, &sourceAccountID, &destinationsJSON, &amountJSON, &frequency, &rule.StartDate, &endDate, &capNull, &rule.Priority, &enabled); err != nil {
		return types.RecurrenceRule{}, err
	}
	if sourceAccountID.Valid {
		value := sourceAccountID.String
		rule.SourceAccountID = &value
	}
	if destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &rule.Destinations); err != nil {
			return types.RecurrenceRule{}, fmt.Errorf("parse rule destinations %s: %w", rule.ID, err)
		}
	} else {
		rule.Destinations = nil
	}
	if err := json.Unmarshal([]byte(amountJSON), &rule.Amount); err != nil {
		return types.RecurrenceRule{}, fmt.Errorf("parse rule amount %s: %w", rule.ID, err)
	}
	rule.Frequency = types.RecurrenceFrequency(frequency)
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

func saveEvaluationTable(tx *planTx, evaluationType string, rows []evaluationRow) error {
	for _, row := range rows {
		configJSON, err := json.Marshal(row.configValue)
		if err != nil {
			return fmt.Errorf("marshal config %s: %w", row.instanceID, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json, plan_id) VALUES (?,?,?,?,?,?, :plan_id)`,
			evaluationType, row.instanceID, row.position, row.name, boolToInt(row.enabled), string(configJSON),
		); err != nil {
			return fmt.Errorf("insert evaluation %s: %w", row.instanceID, err)
		}
	}
	return nil
}

// LoadDocument reads the canonical document; returns nil if absent.
func (s *sqliteStore) LoadDocument() (*types.FinancialModelDocument, error) {
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("load document begin: %w", err)
	}
	defer tx.Rollback()
	document, err := loadDocument(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("load document commit: %w", err)
	}
	return document, nil
}

func loadDocument(q queryer) (*types.FinancialModelDocument, error) {
	var sourcePath string
	var documentPresent int
	if err := q.QueryRow(`SELECT source_path, document_present FROM model_metadata WHERE id = 1 AND plan_id = :plan_id`).Scan(&sourcePath, &documentPresent); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load model metadata: %w", err)
	}
	if documentPresent == 0 {
		return nil, nil
	}
	document := &types.FinancialModelDocument{
		SourcePath:  sourcePath,
		Evaluations: types.EmptyEvaluationTables(),
	}
	accountRows, err := q.Query(`SELECT id, name, kind, min_balance, max_balance, color, enabled FROM accounts WHERE plan_id = :plan_id ORDER BY position`)
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
		document.Accounts = append(document.Accounts, account)
	}
	if err := accountRows.Err(); err != nil {
		accountRows.Close()
		return nil, fmt.Errorf("iterate accounts: %w", err)
	}
	if err := accountRows.Close(); err != nil {
		return nil, fmt.Errorf("close accounts: %w", err)
	}

	checkpointRows, err := q.Query(`SELECT date, account_id, balance, source FROM checkpoints WHERE plan_id = :plan_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer checkpointRows.Close()
	for checkpointRows.Next() {
		checkpoint, err := scanCheckpointRow(checkpointRows)
		if err != nil {
			return nil, err
		}
		document.Checkpoints = append(document.Checkpoints, checkpoint)
	}
	if err := checkpointRows.Err(); err != nil {
		checkpointRows.Close()
		return nil, fmt.Errorf("iterate checkpoints: %w", err)
	}
	if err := checkpointRows.Close(); err != nil {
		return nil, fmt.Errorf("close checkpoints: %w", err)
	}

	postingRows, err := q.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order FROM postings WHERE plan_id = :plan_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer postingRows.Close()
	for postingRows.Next() {
		posting, err := scanPostingRow(postingRows)
		if err != nil {
			return nil, err
		}
		document.Postings = append(document.Postings, posting)
	}
	if err := postingRows.Err(); err != nil {
		postingRows.Close()
		return nil, fmt.Errorf("iterate postings: %w", err)
	}
	if err := postingRows.Close(); err != nil {
		return nil, fmt.Errorf("close postings: %w", err)
	}
	if err := loadPurchasePolicies(q, document.Postings); err != nil {
		return nil, err
	}

	ruleRows, err := q.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled FROM recurrence_rules WHERE plan_id = :plan_id ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer ruleRows.Close()
	for ruleRows.Next() {
		rule, err := scanRuleRow(ruleRows)
		if err != nil {
			return nil, err
		}
		document.RecurrenceRules = append(document.RecurrenceRules, rule)
	}
	if err := ruleRows.Err(); err != nil {
		ruleRows.Close()
		return nil, fmt.Errorf("iterate recurrence rules: %w", err)
	}
	if err := ruleRows.Close(); err != nil {
		return nil, fmt.Errorf("close recurrence rules: %w", err)
	}

	evaluationRows, err := q.Query(`SELECT type, instance_id, name, enabled, config_json FROM evaluations WHERE plan_id = :plan_id ORDER BY type, position`)
	if err != nil {
		return nil, err
	}
	defer evaluationRows.Close()
	for evaluationRows.Next() {
		var evaluationType, instanceID, name, configJSON string
		var enabled int64
		if err := evaluationRows.Scan(&evaluationType, &instanceID, &name, &enabled, &configJSON); err != nil {
			return nil, err
		}
		if rows := document.Evaluations.ByType(evaluationType); rows != nil {
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

	termRows, err := q.Query(`SELECT account_id, minimum_fixed, minimum_percent, due_day, statement_day FROM payment_terms WHERE plan_id = :plan_id ORDER BY position`)
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
		document.PaymentTerms = append(document.PaymentTerms, term)
	}
	if err := termRows.Err(); err != nil {
		termRows.Close()
		return nil, fmt.Errorf("iterate payment terms: %w", err)
	}
	if err := termRows.Close(); err != nil {
		return nil, fmt.Errorf("close payment terms: %w", err)
	}

	if document.Accounts == nil {
		document.Accounts = []types.Account{}
	}
	if document.Checkpoints == nil {
		document.Checkpoints = []types.Checkpoint{}
	}
	if document.Postings == nil {
		document.Postings = []types.Posting{}
	}
	if document.RecurrenceRules == nil {
		document.RecurrenceRules = []types.RecurrenceRule{}
	}
	if document.PaymentTerms == nil {
		document.PaymentTerms = []types.PaymentTerms{}
	}
	return document, nil
}

// DocumentExists reports whether any canonical rows are present.
func (s *sqliteStore) DocumentExists() (bool, error) {
	var present int
	row := s.db.QueryRow(`SELECT document_present FROM model_metadata WHERE id = 1 AND plan_id = :plan_id`)
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
