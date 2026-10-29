package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Schema owns the current SQLite DDL. Row methods (model.go, rows.go,
// sync.go, pinned.go, presets.go, artifacts.go, import.go) operate on tables
// but never define them. SetupDatabase alone creates the shared schema.
// A replacement backend implements Store without importing anything here.

// seedAccount runs only in the transaction that first creates an account scope. A later
// ensure never restores factory presets that the owner deleted.
func seedAccount(tx *accountTx) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO model_metadata (id, source_path, document_present, account_id) VALUES (1, '', 0, :account_id)`); err != nil {
		return fmt.Errorf("ensure model metadata: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_state (id, last_sync_at, account_id) VALUES (1, '', :account_id)`); err != nil {
		return fmt.Errorf("ensure sync state: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_credentials (id, access_url, bridge_host, updated_at, cards_json, account_id) VALUES (1, '', '', '', '[]', :account_id)`); err != nil {
		return fmt.Errorf("ensure sync credentials: %w", err)
	}
	var presetCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM amount_presets WHERE account_id = :account_id`).Scan(&presetCount); err != nil {
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
				`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled, account_id) VALUES (?,?,?,?,?,?,?,?, :account_id)`,
				id, position, seed.Name, seed.Label, seed.Summary, seed.WhenUse, string(amountJSON), boolToInt(seed.Enabled),
			); err != nil {
				return fmt.Errorf("seed preset %s: %w", seed.Name, err)
			}
		}
	}
	return nil
}

func schemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			data BLOB NOT NULL,
			expiry INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS identity_grants (
			id TEXT PRIMARY KEY,
			issuer TEXT NOT NULL,
			subject TEXT NOT NULL,
			sid TEXT NOT NULL,
			expiry INTEGER NOT NULL,
			data BLOB NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS identity_grant_subject ON identity_grants(issuer, subject, sid)`,
		`CREATE TABLE IF NOT EXISTS identity_logout_marks (
			issuer TEXT NOT NULL,
			kind TEXT NOT NULL,
			identifier TEXT NOT NULL,
			seen_at INTEGER NOT NULL,
			expiry INTEGER NOT NULL,
			PRIMARY KEY(issuer, kind, identifier)
		)`,
		`CREATE TABLE IF NOT EXISTS identity_logout_tokens (
			issuer TEXT NOT NULL,
			jti TEXT NOT NULL,
			expiry INTEGER NOT NULL,
			PRIMARY KEY(issuer, jti)
		)`,
		`CREATE TABLE IF NOT EXISTS app_accounts (
			id TEXT PRIMARY KEY,
			issuer TEXT NOT NULL,
			subject TEXT NOT NULL,
			UNIQUE(issuer, subject)
		)`,
		`CREATE TABLE IF NOT EXISTS safe_spending_settings (
			account_id TEXT NOT NULL,
			id INTEGER NOT NULL CHECK (id = 1),
			settings_json TEXT NOT NULL,
			PRIMARY KEY (account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS accounts (
			account_id TEXT NOT NULL,
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'cash',
			min_balance REAL,
			max_balance REAL,
			color TEXT,
			enabled INTEGER NOT NULL,
			PRIMARY KEY (account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS checkpoints (
			account_id TEXT NOT NULL,
			id INTEGER NOT NULL,
			position INTEGER NOT NULL,
			date TEXT NOT NULL,
			model_account_id TEXT NOT NULL,
			balance REAL NOT NULL,
			source TEXT NOT NULL DEFAULT 'user',
			PRIMARY KEY(account_id, id),
			UNIQUE(account_id, model_account_id, date),
			FOREIGN KEY(account_id, model_account_id) REFERENCES accounts(account_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS postings (
			account_id TEXT NOT NULL,
			id TEXT NOT NULL,
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
			source TEXT NOT NULL DEFAULT 'user',
			pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
			void INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1)),
			execution_order INTEGER NOT NULL DEFAULT 0 CHECK (execution_order >= 0),
			receipt_ids TEXT NOT NULL DEFAULT '[]',
			PRIMARY KEY (account_id, id),
			FOREIGN KEY(account_id, source_account_id) REFERENCES accounts(account_id, id) DEFERRABLE INITIALLY DEFERRED,
			FOREIGN KEY(account_id, fulfills_rule_id) REFERENCES recurrence_rules(account_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS posting_sync_keys (
			account_id TEXT NOT NULL,
			provider TEXT NOT NULL,
			bridge_account_id TEXT NOT NULL,
			transaction_id TEXT NOT NULL,
			posting_id TEXT NOT NULL,
			UNIQUE(account_id, posting_id),
			FOREIGN KEY(account_id, posting_id) REFERENCES postings(account_id, id) ON DELETE CASCADE,
			PRIMARY KEY (account_id, provider, bridge_account_id, transaction_id)
		)`,
		`CREATE TABLE IF NOT EXISTS posting_id_migrations (
			account_id TEXT NOT NULL,
			old_id TEXT NOT NULL,
			new_id TEXT NOT NULL,
			PRIMARY KEY(account_id, old_id),
			UNIQUE(account_id, new_id)
		)`,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY
		)`,
		`CREATE TABLE IF NOT EXISTS purchase_policies (
			account_id TEXT NOT NULL,
			posting_id TEXT NOT NULL,
			priority INTEGER NOT NULL CHECK (priority >= 0),
			PRIMARY KEY(account_id, posting_id),
			FOREIGN KEY(account_id, posting_id) REFERENCES postings(account_id, id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS recurrence_rules (
			account_id TEXT NOT NULL,
			id TEXT NOT NULL,
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
			enabled INTEGER NOT NULL,
			PRIMARY KEY (account_id, id),
			FOREIGN KEY(account_id, source_account_id) REFERENCES accounts(account_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS evaluations (
			account_id TEXT NOT NULL,
			type TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			config_json TEXT NOT NULL,
			PRIMARY KEY (account_id, type, instance_id),
			UNIQUE(account_id, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS projection_artifacts (
			account_id TEXT NOT NULL,
			identity TEXT NOT NULL,
			kind TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
			payload TEXT NOT NULL,
			PRIMARY KEY(account_id, identity)
		)`,
		`CREATE TABLE IF NOT EXISTS model_metadata (
			account_id TEXT NOT NULL,
			id INTEGER NOT NULL CHECK (id = 1),
			source_path TEXT NOT NULL,
			document_present INTEGER NOT NULL CHECK (document_present IN (0, 1)),
			PRIMARY KEY(account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS payment_terms (
			account_id TEXT NOT NULL,
			model_account_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			minimum_fixed REAL NOT NULL,
			minimum_percent REAL,
			due_day INTEGER NOT NULL,
			statement_day INTEGER,
			PRIMARY KEY(account_id, model_account_id),
			FOREIGN KEY(account_id, model_account_id) REFERENCES accounts(account_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS entity_ids (
			account_id TEXT NOT NULL,
			id TEXT NOT NULL,
			kind TEXT NOT NULL,
			PRIMARY KEY(account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS account_links (
			account_id TEXT NOT NULL,
			bridge_account_id TEXT NOT NULL,
			model_account_id TEXT NOT NULL,
			bridge_name TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT '',
			origin TEXT NOT NULL DEFAULT 'manual',
			last_seen_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(account_id, bridge_account_id),
			UNIQUE(account_id, model_account_id)
		)`,
		`CREATE TABLE IF NOT EXISTS pinned_evaluations (
			account_id TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			PRIMARY KEY(account_id, instance_id),
			FOREIGN KEY(account_id, instance_id) REFERENCES evaluations(account_id, instance_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS sync_state (
			account_id TEXT NOT NULL,
			id INTEGER NOT NULL CHECK (id = 1),
			last_sync_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS sync_credentials (
			account_id TEXT NOT NULL,
			id INTEGER NOT NULL CHECK (id = 1),
			access_url TEXT NOT NULL DEFAULT '',
			bridge_host TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT '',
			cards_json TEXT NOT NULL DEFAULT '[]',
			PRIMARY KEY(account_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS amount_presets (
			account_id TEXT NOT NULL,
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			label TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			when_use TEXT NOT NULL DEFAULT '',
			amount_json TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			PRIMARY KEY(account_id, id),
			UNIQUE(account_id, name)
		)`,
		blobObjectSchema,
		blobsqlite.Schema,
		receiptSchema,
		`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('receipt-evidence-v1')`,
		`CREATE TABLE IF NOT EXISTS user_groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id),
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS group_members (
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			account_id TEXT NOT NULL REFERENCES app_accounts(id),
			role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
			joined_at INTEGER NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(group_id, account_id)
		)`,
		`CREATE INDEX IF NOT EXISTS group_members_account ON group_members(account_id, group_id)`,
		`CREATE TABLE IF NOT EXISTS group_invites (
			id TEXT PRIMARY KEY,
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			code_hash TEXT NOT NULL UNIQUE,
			created_by_account_id TEXT NOT NULL REFERENCES app_accounts(id),
			expires_at INTEGER NOT NULL,
			max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
			used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
			revoked_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
	}
}

// seedAmountPresets is the factory default recipe list. It runs once on a
// fresh account scope; afterwards presets are ordinary rows the user owns.
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
			Name: "federal-tax", Label: "Federal tax owed", Enabled: true,
			Summary: "Progressive tax on gross pay minus pre-tax slices, per occurrence.",
			WhenUse: "Tax withholding rules that read gross and 401(k) rules.",
			Amount: types.PostingAmountResolution{
				Resolver: "progressive-bracket",
				Config: map[string]any{
					"deduction": 1341.67,
					"brackets": []any{
						map[string]any{"upTo": 2066.67, "rate": 0.10},
						map[string]any{"upTo": nil, "rate": 0.12},
					},
				},
				Inputs: map[string]types.AmountInputBinding{
					"gross":  {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "salary"}},
					"pretax": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "salary_401k"}},
				},
			},
		},
	}
}

// requiredSchemaColumns covers every application table, including identity.
// Validation prepares read-only queries; it never executes DDL or repairs shape.
var requiredSchemaColumns = map[string]string{
	"receipts":               receiptColumns,
	"blob_objects":           "key, state, expires_at",
	"blob_data":              "key, data",
	"sessions":               "token, data, expiry",
	"identity_grants":        "id, issuer, subject, sid, expiry, data",
	"identity_logout_marks":  "issuer, kind, identifier, seen_at, expiry",
	"identity_logout_tokens": "issuer, jti, expiry",
	"app_accounts":           "id, issuer, subject",
	"user_groups":            "id, name, created_by_account_id, created_at",
	"group_members":          "group_id, account_id, role, joined_at, display_name",
	"group_invites":          "id, group_id, code_hash, created_by_account_id, expires_at, max_uses, used_count, revoked_at, created_at",
	"accounts":               "account_id, id, position, name, kind, min_balance, max_balance, color, enabled",
	"checkpoints":            "account_id, id, position, date, model_account_id, balance, source",
	"postings":               "account_id, id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order, receipt_ids",
	"posting_sync_keys":      "account_id, provider, bridge_account_id, transaction_id, posting_id",
	"posting_id_migrations":  "account_id, old_id, new_id",
	"schema_migrations":      "name",
	"purchase_policies":      "account_id, posting_id, priority",
	"recurrence_rules":       "account_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled",
	"evaluations":            "account_id, type, instance_id, position, name, enabled, config_json",
	"projection_artifacts":   "account_id, identity, kind, created_at, payload",
	"model_metadata":         "account_id, id, source_path, document_present",
	"payment_terms":          "account_id, model_account_id, position, minimum_fixed, minimum_percent, due_day, statement_day",
	"entity_ids":             "account_id, id, kind",
	"account_links":          "account_id, bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at",
	"pinned_evaluations":     "account_id, instance_id, position",
	"safe_spending_settings": "account_id, id, settings_json",
	"sync_state":             "account_id, id, last_sync_at",
	"sync_credentials":       "account_id, id, access_url, bridge_host, updated_at, cards_json",
	"amount_presets":         "account_id, id, position, name, label, summary, when_use, amount_json, enabled",
}

func validateSchemaObjects(db queryer) error {
	for table, columns := range requiredSchemaColumns {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return fmt.Errorf("%w: missing table %s", ErrSetupRequired, table)
		}
		err := db.QueryRow(`SELECT ` + columns + ` FROM ` + table + ` LIMIT 0`).Scan()
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: incomplete table %s: %v", ErrSetupRequired, table, err)
		}
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'identity_grant_subject' AND tbl_name = 'identity_grants'`).Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("%w: missing identity_grant_subject index", ErrSetupRequired)
	}
	return checkReceiptBlobSchemaObjects(db)
}

// expectedSchemaTables lists every table SetupDatabase manages.
func expectedSchemaTables() []string {
	return []string{
		"receipts",
		"blob_objects",
		"blob_data",
		"sessions",
		"identity_grants",
		"identity_logout_marks",
		"identity_logout_tokens",
		"app_accounts",
		"user_groups",
		"group_members",
		"group_invites",
		"accounts",
		"checkpoints",
		"postings",
		"posting_sync_keys",
		"posting_id_migrations",
		"schema_migrations",
		"purchase_policies",
		"recurrence_rules",
		"evaluations",
		"projection_artifacts",
		"model_metadata",
		"payment_terms",
		"entity_ids",
		"account_links",
		"pinned_evaluations",
		"safe_spending_settings",
		"sync_state",
		"sync_credentials",
		"amount_presets",
	}
}
