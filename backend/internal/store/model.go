package store

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

// SaveDocument atomically replaces the canonical model document.
func (s *Store) SaveDocument(document *types.FinancialModelDocument) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("save begin: %w", err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, document); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("save commit: %w", err)
	}
	return nil
}

func deleteDocumentRows(tx *sql.Tx) error {
	if _, err := tx.Exec(`DELETE FROM accounts`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM checkpoints`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM postings`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM evaluations`); err != nil {
		return err
	}
	return nil
}

func clearDocument(tx *sql.Tx) error {
	if err := deleteDocumentRows(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE model_metadata SET source_path = '', document_present = 0 WHERE id = 1`); err != nil {
		return fmt.Errorf("clear model metadata: %w", err)
	}
	return nil
}

func replaceDocument(tx *sql.Tx, document *types.FinancialModelDocument) error {
	if err := deleteDocumentRows(tx); err != nil {
		return err
	}

	for position, account := range document.Accounts {
		var minBalance, maxBalance any = types.NoFloor, types.NoCeiling
		if account.MinBalance != nil {
			minBalance = *account.MinBalance
		}
		if account.MaxBalance != nil {
			maxBalance = *account.MaxBalance
		}
		var color any
		if account.Color != nil {
			color = *account.Color
		}
		if _, err := tx.Exec(
			`INSERT INTO accounts (id, position, label, min_balance, max_balance, color, enabled) VALUES (?,?,?,?,?,?,?)`,
			account.ID, position, account.Label, minBalance, maxBalance, color, boolToInt(account.Enabled),
		); err != nil {
			return fmt.Errorf("insert account %s: %w", account.ID, err)
		}
	}
	for position, checkpoint := range document.Checkpoints {
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (position, date, account_id, balance) VALUES (?,?,?,?)`,
			position, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance,
		); err != nil {
			return fmt.Errorf("insert checkpoint: %w", err)
		}
	}
	for position, posting := range document.Postings {
		destinationsJSON := []byte("null")
		if posting.Destinations != nil {
			destinationsJSON, _ = json.Marshal(posting.Destinations)
		}
		amountJSON, err := json.Marshal(posting.Amount)
		if err != nil {
			return fmt.Errorf("marshal amount %s: %w", posting.ID, err)
		}
		var sourceAccountID, endDate, annualCap any
		if posting.SourceAccountID != nil {
			sourceAccountID = *posting.SourceAccountID
		}
		if posting.EndDate != nil {
			endDate = *posting.EndDate
		}
		if posting.AnnualCap != nil {
			annualCap = *posting.AnnualCap
		}
		if _, err := tx.Exec(
			`INSERT INTO postings (id, position, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			posting.ID, position, posting.Label, sourceAccountID, string(destinationsJSON), string(amountJSON),
			string(posting.Frequency), posting.AnnualRate, posting.AnnualGrowthRate, posting.Volatility,
			posting.StartDate, endDate, annualCap, posting.Priority, boolToInt(posting.Enabled),
		); err != nil {
			return fmt.Errorf("insert posting %s: %w", posting.ID, err)
		}
	}
	if err := saveEvaluationTable(tx, string(types.EvaluationTypeFinancialIndependence), fiEvaluationRows(document)); err != nil {
		return err
	}
	if err := saveEvaluationTable(tx, string(types.EvaluationTypeNetWorthThreshold), thresholdEvaluationRows(document)); err != nil {
		return err
	}
	if err := saveEvaluationTable(tx, string(types.EvaluationTypePostingFulfillment), fulfillmentEvaluationRows(document)); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE model_metadata SET source_path = ?, document_present = 1 WHERE id = 1`,
		document.SourcePath,
	); err != nil {
		return fmt.Errorf("save model metadata: %w", err)
	}
	return nil
}

func fiEvaluationRows(d *types.FinancialModelDocument) []evaluationRow {
	rows := make([]evaluationRow, 0, len(d.Evaluations.FinancialIndependence))
	for position, item := range d.Evaluations.FinancialIndependence {
		rows = append(rows, evaluationRow{instanceID: item.InstanceID, position: position, label: item.Label, enabled: item.Enabled, configValue: item.Config})
	}
	return rows
}

func thresholdEvaluationRows(d *types.FinancialModelDocument) []evaluationRow {
	rows := make([]evaluationRow, 0, len(d.Evaluations.NetWorthThreshold))
	for position, item := range d.Evaluations.NetWorthThreshold {
		rows = append(rows, evaluationRow{instanceID: item.InstanceID, position: position, label: item.Label, enabled: item.Enabled, configValue: item.Config})
	}
	return rows
}

func fulfillmentEvaluationRows(d *types.FinancialModelDocument) []evaluationRow {
	rows := make([]evaluationRow, 0, len(d.Evaluations.PostingFulfillment))
	for position, item := range d.Evaluations.PostingFulfillment {
		rows = append(rows, evaluationRow{instanceID: item.InstanceID, position: position, label: item.Label, enabled: item.Enabled, configValue: item.Config})
	}
	return rows
}

type evaluationRow struct {
	instanceID  string
	position    int
	label       string
	enabled     bool
	configValue types.JsonValue
}

func saveEvaluationTable(tx *sql.Tx, evaluationType string, rows []evaluationRow) error {
	for _, row := range rows {
		configJSON, err := json.Marshal(row.configValue)
		if err != nil {
			return fmt.Errorf("marshal config %s: %w", row.instanceID, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO evaluations (type, instance_id, position, label, enabled, config_json) VALUES (?,?,?,?,?,?)`,
			evaluationType, row.instanceID, row.position, row.label, boolToInt(row.enabled), string(configJSON),
		); err != nil {
			return fmt.Errorf("insert evaluation %s: %w", row.instanceID, err)
		}
	}
	return nil
}

// LoadDocument reads the canonical document; returns nil if absent.
func (s *Store) LoadDocument() (*types.FinancialModelDocument, error) {
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
	if err := q.QueryRow(`SELECT source_path, document_present FROM model_metadata WHERE id = 1`).Scan(&sourcePath, &documentPresent); err != nil {
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
	accountRows, err := q.Query(`SELECT id, label, min_balance, max_balance, color, enabled FROM accounts ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer accountRows.Close()
	for accountRows.Next() {
		var account types.Account
		var minBalance, maxBalance sql.NullFloat64
		var color sql.NullString
		var enabled int64
		if err := accountRows.Scan(&account.ID, &account.Label, &minBalance, &maxBalance, &color, &enabled); err != nil {
			return nil, err
		}
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

	checkpointRows, err := q.Query(`SELECT date, account_id, balance FROM checkpoints ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer checkpointRows.Close()
	for checkpointRows.Next() {
		var checkpoint types.Checkpoint
		if err := checkpointRows.Scan(&checkpoint.Date, &checkpoint.AccountID, &checkpoint.Balance); err != nil {
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

	postingRows, err := q.Query(`SELECT id, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled FROM postings ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer postingRows.Close()
	for postingRows.Next() {
		var posting types.Posting
		var sourceAccountID, endDate sql.NullString
		var destinationsJSON, amountJSON string
		var frequency string
		var enabled int64
		var capNull sql.NullFloat64
		if err := postingRows.Scan(&posting.ID, &posting.Label, &sourceAccountID, &destinationsJSON, &amountJSON, &frequency, &posting.AnnualRate, &posting.AnnualGrowthRate, &posting.Volatility, &posting.StartDate, &endDate, &capNull, &posting.Priority, &enabled); err != nil {
			return nil, err
		}
		if sourceAccountID.Valid {
			value := sourceAccountID.String
			posting.SourceAccountID = &value
		}
		if destinationsJSON != "null" {
			if err := json.Unmarshal([]byte(destinationsJSON), &posting.Destinations); err != nil {
				return nil, fmt.Errorf("parse destinations %s: %w", posting.ID, err)
			}
		} else {
			posting.Destinations = nil
		}
		if err := json.Unmarshal([]byte(amountJSON), &posting.Amount); err != nil {
			return nil, fmt.Errorf("parse amount %s: %w", posting.ID, err)
		}
		posting.Frequency = types.PostingFrequency(frequency)
		if endDate.Valid {
			value := endDate.String
			posting.EndDate = &value
		}
		if capNull.Valid {
			value := capNull.Float64
			posting.AnnualCap = &value
		}
		posting.Enabled = enabled != 0
		document.Postings = append(document.Postings, posting)
	}
	if err := postingRows.Err(); err != nil {
		postingRows.Close()
		return nil, fmt.Errorf("iterate postings: %w", err)
	}
	if err := postingRows.Close(); err != nil {
		return nil, fmt.Errorf("close postings: %w", err)
	}

	evaluationRows, err := q.Query(`SELECT type, instance_id, label, enabled, config_json FROM evaluations ORDER BY type, position`)
	if err != nil {
		return nil, err
	}
	defer evaluationRows.Close()
	for evaluationRows.Next() {
		var evaluationType, instanceID, label, configJSON string
		var enabled int64
		if err := evaluationRows.Scan(&evaluationType, &instanceID, &label, &enabled, &configJSON); err != nil {
			return nil, err
		}
		switch types.EvaluationType(evaluationType) {
		case types.EvaluationTypeFinancialIndependence:
			config := map[string]any{}
			if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
				return nil, fmt.Errorf("parse FI config %s: %w", instanceID, err)
			}
			document.Evaluations.FinancialIndependence = append(document.Evaluations.FinancialIndependence, types.FIEvaluation{
				InstanceID: instanceID, Label: label, Enabled: enabled != 0, Config: config,
			})
		case types.EvaluationTypeNetWorthThreshold:
			config := map[string]any{}
			if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
				return nil, fmt.Errorf("parse threshold config %s: %w", instanceID, err)
			}
			document.Evaluations.NetWorthThreshold = append(document.Evaluations.NetWorthThreshold, types.ThresholdEvaluation{
				InstanceID: instanceID, Label: label, Enabled: enabled != 0, Config: config,
			})
		case types.EvaluationTypePostingFulfillment:
			config := map[string]any{}
			if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
				return nil, fmt.Errorf("parse fulfillment config %s: %w", instanceID, err)
			}
			document.Evaluations.PostingFulfillment = append(document.Evaluations.PostingFulfillment, types.FulfillmentEvaluation{
				InstanceID: instanceID, Label: label, Enabled: enabled != 0, Config: config,
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

	if document.Accounts == nil {
		document.Accounts = []types.Account{}
	}
	if document.Checkpoints == nil {
		document.Checkpoints = []types.Checkpoint{}
	}
	if document.Postings == nil {
		document.Postings = []types.Posting{}
	}
	return document, nil
}

// DocumentExists reports whether any canonical rows are present.
func (s *Store) DocumentExists() (bool, error) {
	var present int
	row := s.db.QueryRow(`SELECT document_present FROM model_metadata WHERE id = 1`)
	if err := row.Scan(&present); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return present != 0, nil
}

// SaveIncomeData replaces income source/tax profile tables.
func (s *Store) SaveIncomeData(snapshot *types.IncomeDataSnapshot) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := replaceIncomeData(tx, snapshot); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("save income commit: %w", err)
	}
	return nil
}

func replaceIncomeData(tx *sql.Tx, snapshot *types.IncomeDataSnapshot) error {
	if _, err := tx.Exec(`DELETE FROM income_sources`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM tax_profiles`); err != nil {
		return err
	}
	for position, source := range snapshot.IncomeSources {
		var effectiveTo any
		if source.EffectiveTo != nil {
			effectiveTo = *source.EffectiveTo
		}
		if _, err := tx.Exec(
			`INSERT INTO income_sources (id, position, label, effective_from, effective_to, annual_gross_income) VALUES (?,?,?,?,?,?)`,
			source.ID, position, source.Label, source.EffectiveFrom, effectiveTo, source.AnnualGrossIncome,
		); err != nil {
			return err
		}
	}
	for position, profile := range snapshot.TaxProfiles {
		bracketsJSON, err := json.Marshal(profile.Brackets)
		if err != nil {
			return err
		}
		var sourceURL any
		if profile.SourceURL != nil {
			sourceURL = *profile.SourceURL
		}
		if _, err := tx.Exec(
			`INSERT INTO tax_profiles (id, position, label, deduction, brackets_json, source_url) VALUES (?,?,?,?,?,?)`,
			profile.ID, position, profile.Label, profile.Deduction, string(bracketsJSON), sourceURL,
		); err != nil {
			return err
		}
	}
	return nil
}

// LoadIncomeData reads the income snapshot.
func (s *Store) LoadIncomeData() (*types.IncomeDataSnapshot, error) {
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("load income begin: %w", err)
	}
	defer tx.Rollback()
	snapshot, err := loadIncomeData(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("load income commit: %w", err)
	}
	return snapshot, nil
}

func loadIncomeData(q queryer) (*types.IncomeDataSnapshot, error) {
	snapshot := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{},
		TaxProfiles:   []types.IncomeTaxProfile{},
	}
	rows, err := q.Query(`SELECT id, label, effective_from, effective_to, annual_gross_income FROM income_sources ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var source types.IncomeSourceDefinition
		var effectiveTo sql.NullString
		if err := rows.Scan(&source.ID, &source.Label, &source.EffectiveFrom, &effectiveTo, &source.AnnualGrossIncome); err != nil {
			return nil, err
		}
		if effectiveTo.Valid {
			value := effectiveTo.String
			source.EffectiveTo = &value
		}
		snapshot.IncomeSources = append(snapshot.IncomeSources, source)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate income sources: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close income sources: %w", err)
	}
	profileRows, err := q.Query(`SELECT id, label, deduction, brackets_json, source_url FROM tax_profiles ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer profileRows.Close()
	for profileRows.Next() {
		var profile types.IncomeTaxProfile
		var bracketsJSON string
		var sourceURL sql.NullString
		if err := profileRows.Scan(&profile.ID, &profile.Label, &profile.Deduction, &bracketsJSON, &sourceURL); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(bracketsJSON), &profile.Brackets); err != nil {
			return nil, fmt.Errorf("parse brackets %s: %w", profile.ID, err)
		}
		if sourceURL.Valid {
			value := sourceURL.String
			profile.SourceURL = &value
		}
		snapshot.TaxProfiles = append(snapshot.TaxProfiles, profile)
	}
	if err := profileRows.Err(); err != nil {
		profileRows.Close()
		return nil, fmt.Errorf("iterate tax profiles: %w", err)
	}
	if err := profileRows.Close(); err != nil {
		return nil, fmt.Errorf("close tax profiles: %w", err)
	}
	return snapshot, nil
}

// LoadDocumentAndIncomeData reads one consistent model and income snapshot.
func (s *Store) LoadDocumentAndIncomeData() (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error) {
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, fmt.Errorf("load aggregate begin: %w", err)
	}
	defer tx.Rollback()
	document, err := loadDocument(tx)
	if err != nil {
		return nil, nil, err
	}
	incomeData, err := loadIncomeData(tx)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("load aggregate commit: %w", err)
	}
	return document, incomeData, nil
}

// GetArtifact / PutArtifact implement the bounded artifact cache.
func (s *Store) GetArtifact(identity string) (string, bool, error) {
	row := s.db.QueryRow(`SELECT payload FROM projection_artifacts WHERE identity = ?`, identity)
	var payload string
	if err := row.Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return payload, true, nil
}

func (s *Store) PutArtifact(identity, kind, payload string) error {
	const maxArtifacts = 256
	_, err := s.db.Exec(
		`INSERT INTO projection_artifacts (identity, kind, payload) VALUES (?,?,?)
		 ON CONFLICT(identity) DO NOTHING`,
		identity, kind, payload,
	)
	if err != nil {
		return err
	}
	// Evict oldest rows regardless of kind so stochastic entries cannot grow
	// without bound.
	_, err = s.db.Exec(`
		DELETE FROM projection_artifacts WHERE identity IN (
			SELECT identity FROM projection_artifacts
			ORDER BY created_at LIMIT MAX(0, (SELECT COUNT(*) FROM projection_artifacts) - ?)
		)`, maxArtifacts)
	return err
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
