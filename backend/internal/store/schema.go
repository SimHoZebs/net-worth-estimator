package store

import (
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Schema owns the current SQLite DDL. Row methods (model.go, rows.go,
// sync.go, pinned.go, presets.go, artifacts.go, import.go) operate on tables
// but never define them; Open applies ensureSchema before serving traffic.
// There is no version history and no upgrade path: old databases are not
// supported. A replacement backend implements Store without importing
// anything here.

// ensureSchema creates every table in its current shape and seeds the
// singleton rows plus the factory-default amount presets. It is idempotent:
// existing tables and rows are left untouched.
func (s *sqliteStore) ensureSchema() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin schema: %w", err)
	}
	defer tx.Rollback()
	for _, statement := range schemaStatements() {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("ensure schema: %w", err)
		}
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO model_metadata (id, source_path, document_present) VALUES (1, '', 0)`); err != nil {
		return fmt.Errorf("ensure model metadata: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_state (id, last_sync_at) VALUES (1, '')`); err != nil {
		return fmt.Errorf("ensure sync state: %w", err)
	}
	var presetCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM amount_presets`).Scan(&presetCount); err != nil {
		return fmt.Errorf("count amount presets: %w", err)
	}
	if presetCount == 0 {
		for position, seed := range seedAmountPresets() {
			amountJSON, err := json.Marshal(seed.Amount)
			if err != nil {
				return fmt.Errorf("marshal preset %s: %w", seed.Name, err)
			}
			id, err := newRowID()
			if err != nil {
				return err
			}
			if _, err := tx.Exec(
				`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled) VALUES (?,?,?,?,?,?,?,?)`,
				id, position, seed.Name, seed.Label, seed.Summary, seed.WhenUse, string(amountJSON), boolToInt(seed.Enabled),
			); err != nil {
				return fmt.Errorf("seed preset %s: %w", seed.Name, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit schema: %w", err)
	}
	return nil
}

func schemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS accounts (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'cash',
			min_balance REAL,
			max_balance REAL,
			color TEXT,
			enabled INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS checkpoints (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			position INTEGER NOT NULL,
			date TEXT NOT NULL,
			account_id TEXT NOT NULL,
			balance REAL NOT NULL,
			source TEXT NOT NULL DEFAULT 'model',
			UNIQUE(account_id, date)
		)`,
		`CREATE TABLE IF NOT EXISTS postings (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			source_account_id TEXT,
			destinations TEXT,
			amount_resolution_json TEXT NOT NULL,
			posted_time INTEGER NOT NULL,
			transaction_time INTEGER NOT NULL,
			fulfills_rule_id TEXT,
			fulfills_occurrence_date TEXT,
			enabled INTEGER NOT NULL,
			source TEXT NOT NULL DEFAULT 'model'
		)`,
		`CREATE TABLE IF NOT EXISTS recurrence_rules (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			source_account_id TEXT,
			destinations TEXT,
			amount_resolution_json TEXT NOT NULL,
			frequency TEXT NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT,
			annual_cap REAL,
			priority INTEGER NOT NULL,
			enabled INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS evaluations (
			type TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			config_json TEXT NOT NULL,
			PRIMARY KEY (type, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS income_sources (
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			effective_from TEXT NOT NULL,
			effective_to TEXT,
			annual_gross_income REAL NOT NULL,
			PRIMARY KEY (id, effective_from)
		)`,
		`CREATE TABLE IF NOT EXISTS tax_profiles (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			deduction REAL NOT NULL,
			brackets_json TEXT NOT NULL,
			source_url TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS projection_artifacts (
			identity TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
			payload TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS model_metadata (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			source_path TEXT NOT NULL,
			document_present INTEGER NOT NULL CHECK (document_present IN (0, 1))
		)`,
		`CREATE TABLE IF NOT EXISTS payment_terms (
			account_id TEXT PRIMARY KEY,
			position INTEGER NOT NULL,
			minimum_fixed REAL NOT NULL,
			minimum_percent REAL,
			due_day INTEGER NOT NULL,
			statement_day INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS entity_ids (
			id TEXT PRIMARY KEY,
			kind TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS account_links (
			bridge_account_id TEXT PRIMARY KEY,
			model_account_id TEXT NOT NULL UNIQUE,
			bridge_name TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT '',
			origin TEXT NOT NULL DEFAULT 'manual',
			last_seen_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS pinned_evaluations (
			instance_id TEXT PRIMARY KEY,
			position INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sync_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			last_sync_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS amount_presets (
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
}

// seedAmountPresets is the factory default recipe list. It runs once on a
// fresh database; afterwards presets are ordinary rows the user owns.
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

// expectedSchemaTables lists every table ensureSchema manages. Tests use it
// to prove Open creates the full current shape.
func expectedSchemaTables() []string {
	return []string{
		"accounts",
		"checkpoints",
		"postings",
		"recurrence_rules",
		"evaluations",
		"income_sources",
		"tax_profiles",
		"projection_artifacts",
		"model_metadata",
		"payment_terms",
		"entity_ids",
		"account_links",
		"pinned_evaluations",
		"sync_state",
		"amount_presets",
	}
}
