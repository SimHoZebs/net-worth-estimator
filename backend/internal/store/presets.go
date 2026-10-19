package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount presets are saved amount recipes. They live outside the canonical
// financial model document, so they never affect the document ETag,
// validation, or the row-sync diff — exactly like pinned evaluations.
// Preset writes run in their own transaction and never mark the model
// document present: saving a preset into an empty database must not fake
// a model. Clear and CSV import leave presets alone: presets are user
// configuration, not model data.
//
// Referential rule: none. The amount descriptor may reference placeholder
// IDs; placeholders resolve at authoring time when the UI copies the
// descriptor into a posting or rule. Names are unique and immutable: the
// name is the stable key the UI binds to, while IDs stay internal.
func migrateV14(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE amount_presets (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL UNIQUE,
			label TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			when_use TEXT NOT NULL DEFAULT '',
			amount_json TEXT NOT NULL,
			enabled INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate schema version 14: %w", err)
		}
	}
	for position, seed := range seedAmountPresets() {
		amountJSON, err := json.Marshal(seed.Amount)
		if err != nil {
			return fmt.Errorf("migrate schema version 14 marshal preset %s: %w", seed.Name, err)
		}
		id, err := newRowID()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled) VALUES (?,?,?,?,?,?,?,?)`,
			id, position, seed.Name, seed.Label, seed.Summary, seed.WhenUse, string(amountJSON), boolToInt(seed.Enabled),
		); err != nil {
			return fmt.Errorf("migrate schema version 14 seed preset %s: %w", seed.Name, err)
		}
	}
	return nil
}

// seedAmountPresets is the factory default recipe list. It runs once at
// migration time; afterwards presets are ordinary rows the user owns.
func seedAmountPresets() []types.AmountPreset {
	fixed := func(expression string) types.PostingAmountResolution {
		return types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": expression},
			Inputs:   map[string]types.AmountInputBinding{},
		}
	}
	return []types.AmountPreset{
		{
			Name: "fixed", Label: "Fixed amount", Enabled: true,
			Summary: "Same dollars every time. Example: $500 monthly investing.",
			WhenUse: "Rent, fixed savings, any bill that never changes.",
			Amount:  fixed("500"),
		},
		{
			Name: "growth", Label: "Grows yearly by %", Enabled: true,
			Summary: "Starts at a base amount, then grows by a yearly percent from the start date.",
			WhenUse: "Salary that rises 3% a year, rent that climbs.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "(base) * growth"},
				Inputs: map[string]types.AmountInputBinding{
					"base":   {Source: "literal", Value: 500.0},
					"growth": {Source: "provider", Provider: "growth-factor", Arguments: map[string]any{"annualGrowthRate": 0.03}},
				},
			},
		},
		{
			Name: "account-percent", Label: "Percent of account", Enabled: true,
			Summary: "A percent of a live account balance. Example: 4% withdrawal.",
			WhenUse: "Withdrawals tied to balance, fees tied to what you owe.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "balance * pct"},
				Inputs: map[string]types.AmountInputBinding{
					"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "brokerage"}},
					"pct":     {Source: "literal", Value: 0.04},
				},
			},
		},
		{
			Name: "investment-growth", Label: "Investment growth", Enabled: true,
			Summary: "Balance times a yearly rate, split across paychecks. Add wobble to model uncertainty ranges.",
			WhenUse: "Brokerage or savings growth with optional volatility.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "brokerage * rate"},
				Inputs: map[string]types.AmountInputBinding{
					"brokerage": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "brokerage"}},
					"rate":      {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07, "volatility": 0.12}},
				},
			},
		},
		{
			Name: "debt-minimum", Label: "Card minimum due", Enabled: true,
			Summary: "Pays exactly what the card requires, no more.",
			WhenUse: "Minimum-only debt payments.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "minimum"},
				Inputs: map[string]types.AmountInputBinding{
					"minimum": {Source: "provider", Provider: "terms-minimum", Arguments: map[string]any{"id": "prime_card"}},
				},
			},
		},
		{
			Name: "late-fee", Label: "Late fee if short", Enabled: true,
			Summary: "Adds a flat fee only when the payment was short this month.",
			WhenUse: "Model penalties without overcharging on-time months.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "fee"},
				Inputs: map[string]types.AmountInputBinding{
					"fee": {Source: "provider", Provider: "late-fee", Arguments: map[string]any{"payment": "card_payment", "account": "prime_card", "fee": 30.0}},
				},
			},
		},
		{
			Name: "low-balance-fee", Label: "Low-balance fee", Enabled: true,
			Summary: "Adds a flat fee only when the balance drops below a limit.",
			WhenUse: "Bank fees tied to minimum balances.",
			Amount: types.PostingAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "fee"},
				Inputs: map[string]types.AmountInputBinding{
					"fee": {Source: "provider", Provider: "balance-fee", Arguments: map[string]any{"account": "checking", "threshold": 1500.0, "fee": 12.0}},
				},
			},
		},
		{
			Name: "paycheck", Label: "Paycheck take-home", Enabled: true,
			Summary: "Yearly salary minus 401k percent and tax table, in order. Remainder lands as take-home pay.",
			WhenUse: "Any salary with pre-tax savings and taxes.",
			Amount: types.PostingAmountResolution{
				Resolver: "income",
				Config: map[string]any{
					"incomeSourceId": "salary",
					"resolvers": []any{
						map[string]any{"resolver": "percentage", "config": map[string]any{"rate": 0.10, "annualCap": 23500.0}, "destinationAccountId": "401k"},
						map[string]any{"resolver": "progressive-bracket", "config": map[string]any{"profileId": "federal"}},
					},
				},
				Inputs: map[string]types.AmountInputBinding{},
			},
		},
	}
}

// ListAmountPresets returns presets in stored order.
func (s *sqliteStore) ListAmountPresets() ([]types.AmountPreset, error) {
	rows, err := s.db.Query(`SELECT id, name, label, summary, when_use, amount_json, enabled FROM amount_presets ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("list amount presets: %w", err)
	}
	defer rows.Close()
	presets := []types.AmountPreset{}
	for rows.Next() {
		preset, err := scanPresetRow(rows)
		if err != nil {
			return nil, err
		}
		presets = append(presets, preset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return presets, rows.Close()
}

func scanPresetRow(rows *sql.Rows) (types.AmountPreset, error) {
	var preset types.AmountPreset
	var summary, whenUse sql.NullString
	var amountJSON string
	var enabled int64
	if err := rows.Scan(&preset.ID, &preset.Name, &preset.Label, &summary, &whenUse, &amountJSON, &enabled); err != nil {
		return types.AmountPreset{}, err
	}
	if summary.Valid {
		preset.Summary = summary.String
	}
	if whenUse.Valid {
		preset.WhenUse = whenUse.String
	}
	if err := json.Unmarshal([]byte(amountJSON), &preset.Amount); err != nil {
		return types.AmountPreset{}, fmt.Errorf("parse preset amount %s: %w", preset.ID, err)
	}
	preset.Enabled = enabled != 0
	return preset, nil
}

// presetTx runs a preset write without marking the model document present.
func presetTx(db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("preset write commit: %w", err)
	}
	return nil
}

func insertPreset(tx *sql.Tx, position int, preset *types.AmountPreset) error {
	amountJSON, err := json.Marshal(preset.Amount)
	if err != nil {
		return fmt.Errorf("marshal preset amount %s: %w", preset.ID, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled) VALUES (?,?,?,?,?,?,?,?)`,
		preset.ID, position, preset.Name, preset.Label, preset.Summary, preset.WhenUse, string(amountJSON), boolToInt(preset.Enabled),
	); err != nil {
		if isUniqueViolation(err) {
			return &rowError{code: "id-conflict", id: preset.Name}
		}
		return fmt.Errorf("insert amount preset %s: %w", preset.ID, err)
	}
	return nil
}

// CreateAmountPreset inserts one preset. An empty ID gets a UUIDv7; names
// are unique and sync-namespace IDs are rejected like every other row.
func (s *sqliteStore) CreateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error) {
	if err := ValidateAmountPresetName(preset.Name); err != nil {
		return types.AmountPreset{}, err
	}
	if preset.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.AmountPreset{}, err
		}
		preset.ID = id
	}
	if IsSyncPostingID(preset.ID) {
		return types.AmountPreset{}, &rowError{code: "reserved-id", id: preset.ID}
	}
	err := presetTx(s.db, func(tx *sql.Tx) error {
		position, err := nextTablePosition(tx, "amount_presets")
		if err != nil {
			return err
		}
		return insertPreset(tx, position, &preset)
	})
	if err != nil {
		return types.AmountPreset{}, err
	}
	return preset, nil
}

// UpdateAmountPreset replaces one preset by ID. The name is immutable: it
// is the stable key the UI binds to.
func (s *sqliteStore) UpdateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error) {
	if preset.ID == "" {
		return types.AmountPreset{}, &rowError{code: "not-found", id: ""}
	}
	if err := ValidateAmountPresetName(preset.Name); err != nil {
		return types.AmountPreset{}, err
	}
	err := presetTx(s.db, func(tx *sql.Tx) error {
		var position int
		var storedName string
		if err := tx.QueryRow(`SELECT position, name FROM amount_presets WHERE id = ?`, preset.ID).Scan(&position, &storedName); err != nil {
			if err == sql.ErrNoRows {
				return &rowError{code: "not-found", id: preset.ID}
			}
			return fmt.Errorf("read amount preset %s: %w", preset.ID, err)
		}
		if preset.Name != storedName {
			return fmt.Errorf("amount preset %s name is immutable", preset.ID)
		}
		if _, err := tx.Exec(`DELETE FROM amount_presets WHERE id = ?`, preset.ID); err != nil {
			return fmt.Errorf("replace amount preset %s: %w", preset.ID, err)
		}
		return insertPreset(tx, position, &preset)
	})
	if err != nil {
		return types.AmountPreset{}, err
	}
	return preset, nil
}

// DeleteAmountPreset removes one preset.
func (s *sqliteStore) DeleteAmountPreset(id string) error {
	return presetTx(s.db, func(tx *sql.Tx) error {
		result, err := tx.Exec(`DELETE FROM amount_presets WHERE id = ?`, id)
		if err != nil {
			return fmt.Errorf("delete amount preset %s: %w", id, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: id}
		}
		return nil
	})
}

// MoveAmountPreset positions one preset before another (or appends).
func (s *sqliteStore) MoveAmountPreset(id, beforeID string) error {
	return presetTx(s.db, func(tx *sql.Tx) error {
		return moveRow(tx, RowPreset, "", id, beforeID)
	})
}

// ValidateAmountPresetName checks the stable key shape before persistence.
func ValidateAmountPresetName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return fmt.Errorf("preset name must be a non-empty string")
	}
	if len(trimmed) > 100 {
		return fmt.Errorf("preset name must be at most 100 characters")
	}
	return nil
}
