package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SaveDocument atomically replaces the canonical model document.
func (s *Store) SaveDocument(document *types.FinancialModelDocument) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("save begin: %w", err)
	}
	defer tx.Rollback()
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
	for _, checkpoint := range document.Checkpoints {
		if _, err := tx.Exec(
			`INSERT INTO checkpoints (date, account_id, balance) VALUES (?,?,?)`,
			checkpoint.Date, checkpoint.AccountID, checkpoint.Balance,
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
	return tx.Commit()
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
	document := &types.FinancialModelDocument{
		Evaluations: types.EmptyEvaluationTables(),
	}
	accountRows, err := s.db.Query(`SELECT id, label, min_balance, max_balance, color, enabled FROM accounts ORDER BY position`)
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

	checkpointRows, err := s.db.Query(`SELECT date, account_id, balance FROM checkpoints ORDER BY date, rowid`)
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

	postingRows, err := s.db.Query(`SELECT id, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, end_date, annual_cap, priority, enabled FROM postings ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer postingRows.Close()
	for postingRows.Next() {
		var posting types.Posting
		var sourceAccountID, endDate, annualCap sql.NullString
		var destinationsJSON, amountJSON string
		var frequency string
		var enabled int64
		var capNull sql.NullFloat64
		if err := postingRows.Scan(&posting.ID, &posting.Label, &sourceAccountID, &destinationsJSON, &amountJSON, &frequency, &posting.AnnualRate, &posting.AnnualGrowthRate, &posting.Volatility, &posting.StartDate, &endDate, &capNull, &posting.Priority, &enabled); err != nil {
			return nil, err
		}
		_ = annualCap
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

	evaluationRows, err := s.db.Query(`SELECT type, instance_id, label, enabled, config_json FROM evaluations ORDER BY type, position`)
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
	var count int64
	row := s.db.QueryRow(`SELECT COUNT(*) FROM accounts`)
	if err := row.Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

// SaveIncomeData replaces income source/tax profile tables.
func (s *Store) SaveIncomeData(snapshot *types.IncomeDataSnapshot) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
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
	return tx.Commit()
}

// LoadIncomeData reads the income snapshot.
func (s *Store) LoadIncomeData() (*types.IncomeDataSnapshot, error) {
	snapshot := &types.IncomeDataSnapshot{
		IncomeSources: []types.IncomeSourceDefinition{},
		TaxProfiles:   []types.IncomeTaxProfile{},
	}
	rows, err := s.db.Query(`SELECT id, label, effective_from, effective_to, annual_gross_income FROM income_sources ORDER BY position`)
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
	profileRows, err := s.db.Query(`SELECT id, label, deduction, brackets_json, source_url FROM tax_profiles ORDER BY position`)
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
	return snapshot, nil
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
