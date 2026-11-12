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

// seedUserTables runs only in the transaction that first creates a user.
// A later ensure never restores factory presets that the owner deleted.
func seedUserTables(tx *userTx) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO model_metadata (user_id, id, source_path, document_present) VALUES (:user_id, 1, '', 0)`); err != nil {
		return fmt.Errorf("ensure model metadata: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_state (user_id, id, last_sync_at) VALUES (:user_id, 1, '')`); err != nil {
		return fmt.Errorf("ensure sync state: %w", err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_credentials (user_id, id, access_url, bridge_host, updated_at, cards_json) VALUES (:user_id, 1, '', '', '', '[]')`); err != nil {
		return fmt.Errorf("ensure sync credentials: %w", err)
	}
	var presetCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM amount_presets WHERE user_id = :user_id`).Scan(&presetCount); err != nil {
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
				`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled, user_id) VALUES (?,?,?,?,?,?,?,?, :user_id)`,
				id, position, seed.Name, seed.Label, seed.Summary, seed.WhenUse, string(amountJSON), boolToInt(seed.Enabled),
			); err != nil {
				return fmt.Errorf("seed preset %s: %w", seed.Name, err)
			}
		}
	}
	return nil
}

// suppressedSyncKeysDDL is the do-not-import list: bank ids the owner
// removed stay removed. Fresh and migrated databases receive it from
// schemaStatements; unmigrated databases fail current-schema validation.
const suppressedSyncKeysDDL = `CREATE TABLE IF NOT EXISTS suppressed_sync_keys (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	bridge_account_id TEXT NOT NULL,
	bank_transaction_id TEXT NOT NULL,
	suppressed_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, provider, bridge_account_id, bank_transaction_id)
)`

// transactionCategoriesDDL is one assignment per transaction. It is a sidecar table,
// not a taxonomy: the supported keys live in Go. Fresh databases get it from
// schemaStatements; existing databases self-heal at first use so no operator
// migration is needed for this additive metadata.
const transactionCategoriesDDL = `CREATE TABLE IF NOT EXISTS transaction_categories (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL,
	category TEXT NOT NULL,
	source TEXT NOT NULL CHECK(source IN ('bank', 'inferred', 'user')),
	producer TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, transaction_id),
	FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
)`

// checkpointAvailableBalancesDDL is bank evidence tied to one checkpoint.
// It is additive metadata: fresh and migrated databases receive it from
// schemaStatements; unmigrated databases fail current-schema validation.
// The posted balance stays the financial authority; this table only records
// the Bridge's separate available figure.
const checkpointAvailableBalancesDDL = `CREATE TABLE IF NOT EXISTS checkpoint_available_balances (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	model_account_id TEXT NOT NULL,
	observed_at INTEGER NOT NULL,
	available_balance REAL NOT NULL,
	PRIMARY KEY (user_id, model_account_id, observed_at)
)`

func schemaStatements() []string {
	statements := []string{
		accountDisplaysDDL,
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
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			issuer TEXT NOT NULL,
			subject TEXT NOT NULL,
			UNIQUE(issuer, subject)
		)`,
		`CREATE TABLE IF NOT EXISTS safe_spending_settings (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id INTEGER NOT NULL CHECK (id = 1),
			settings_json TEXT NOT NULL,
			PRIMARY KEY (user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS accounts (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'cash',
			min_balance REAL,
			max_balance REAL,
			color TEXT,
			enabled INTEGER NOT NULL,
			PRIMARY KEY (user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS checkpoints (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id INTEGER NOT NULL,
			position INTEGER NOT NULL,
			model_account_id TEXT NOT NULL,
			balance REAL NOT NULL,
			source TEXT NOT NULL DEFAULT 'user',
			provider TEXT NOT NULL DEFAULT '',
			observed_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, id),
			UNIQUE(user_id, model_account_id, observed_at),
			FOREIGN KEY(user_id, model_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		checkpointAvailableBalancesDDL,
		`CREATE TABLE IF NOT EXISTS transactions (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			name TEXT NOT NULL,
			source_account_id TEXT,
			destination_account_ids TEXT,
			amount_resolution_json TEXT NOT NULL,
			posted_time INTEGER NOT NULL,
			transaction_time INTEGER NOT NULL,
			source TEXT NOT NULL DEFAULT 'user',
			pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
			void INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1)),
			projection_slice_id TEXT,
			event_json TEXT,
			applied_amount REAL,
			outcome TEXT,
			PRIMARY KEY (user_id, id),
			FOREIGN KEY(user_id, source_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE INDEX IF NOT EXISTS transactions_projection_slice ON transactions(user_id, projection_slice_id)`,
		`CREATE TABLE IF NOT EXISTS transaction_sim (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			transaction_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
			execution_order INTEGER NOT NULL DEFAULT 0 CHECK(execution_order >= 0),
			PRIMARY KEY(user_id, transaction_id),
			FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_claims (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			transaction_id TEXT NOT NULL,
			fulfills_rule_id TEXT NOT NULL,
			fulfills_occurrence_date TEXT NOT NULL,
			PRIMARY KEY(user_id, transaction_id),
			FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE,
			FOREIGN KEY(user_id, fulfills_rule_id) REFERENCES recurrence_rules(user_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_sync_keys (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider TEXT NOT NULL,
			bridge_account_id TEXT NOT NULL,
			bank_transaction_id TEXT NOT NULL,
			transaction_id TEXT NOT NULL,
			UNIQUE(user_id, transaction_id),
			FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE,
			PRIMARY KEY (user_id, provider, bridge_account_id, bank_transaction_id)
		)`,
		suppressedSyncKeysDDL,
		transactionCategoriesDDL,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY
		)`,
		plannedPurchaseSchema,
		`CREATE TABLE IF NOT EXISTS recurrence_rules (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
			PRIMARY KEY (user_id, id),
			FOREIGN KEY(user_id, source_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS evaluations (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			config_json TEXT NOT NULL,
			PRIMARY KEY (user_id, type, instance_id),
			UNIQUE(user_id, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS model_metadata (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id INTEGER NOT NULL CHECK (id = 1),
			source_path TEXT NOT NULL,
			document_present INTEGER NOT NULL CHECK (document_present IN (0, 1)),
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS payment_terms (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			model_account_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			minimum_fixed REAL NOT NULL,
			minimum_percent REAL,
			due_day INTEGER NOT NULL,
			statement_day INTEGER,
			PRIMARY KEY(user_id, model_account_id),
			FOREIGN KEY(user_id, model_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS entity_ids (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			kind TEXT NOT NULL,
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS account_links (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			bridge_account_id TEXT NOT NULL,
			model_account_id TEXT NOT NULL,
			bridge_name TEXT NOT NULL DEFAULT '',
			institution TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT '',
			origin TEXT NOT NULL DEFAULT 'manual',
			last_seen_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, bridge_account_id),
			UNIQUE(user_id, model_account_id)
		)`,
		`CREATE TABLE IF NOT EXISTS pinned_evaluations (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			PRIMARY KEY(user_id, instance_id),
			FOREIGN KEY(user_id, instance_id) REFERENCES evaluations(user_id, instance_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS sync_state (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id INTEGER NOT NULL CHECK (id = 1),
			last_sync_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS sync_credentials (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id INTEGER NOT NULL CHECK (id = 1),
			access_url TEXT NOT NULL DEFAULT '',
			bridge_host TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT '',
			cards_json TEXT NOT NULL DEFAULT '[]',
			PRIMARY KEY(user_id, id)
		)`,
		gmailCredentialsDDL,
		emailReceiptsDDL,
		`CREATE TABLE IF NOT EXISTS amount_presets (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			label TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			when_use TEXT NOT NULL DEFAULT '',
			amount_json TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			PRIMARY KEY(user_id, id),
			UNIQUE(user_id, name)
		)`,
		blobObjectSchema,
		blobsqlite.Schema,
		receiptSchema,
		`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('receipt-evidence-v1')`,
		`CREATE TABLE IF NOT EXISTS provider_connections (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			provider_key TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT '',
			sync_cursor TEXT NOT NULL DEFAULT '',
			last_synced_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS projection_states (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			scope_id TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 0,
			published_revision INTEGER NOT NULL DEFAULT 0,
			dirty_from INTEGER NOT NULL DEFAULT 0,
			projection_start TEXT NOT NULL DEFAULT '',
			horizon_end TEXT NOT NULL DEFAULT '',
			calendar_timezone TEXT NOT NULL DEFAULT 'UTC',
			engine_version TEXT NOT NULL DEFAULT 'v1',
			trial_count INTEGER NOT NULL DEFAULT 1000,
			stochastic_seed INTEGER,
			det_evaluations_json TEXT NOT NULL DEFAULT '',
			stoch_evaluations_json TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE TABLE IF NOT EXISTS projection_slices (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			projection_state_id TEXT NOT NULL,
			from_at INTEGER NOT NULL,
			to_at INTEGER NOT NULL,
			built_revision INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE INDEX IF NOT EXISTS projection_slices_state ON projection_slices(user_id, projection_state_id, from_at)`,
		`CREATE TABLE IF NOT EXISTS monte_carlo_statistics (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL,
			projection_slice_id TEXT NOT NULL,
			account_id TEXT NOT NULL,
			as_of_at TEXT NOT NULL,
			sample_count INTEGER NOT NULL DEFAULT 0,
			mean REAL NOT NULL DEFAULT 0,
			median REAL NOT NULL DEFAULT 0,
			p10 REAL NOT NULL DEFAULT 0,
			p25 REAL NOT NULL DEFAULT 0,
			p50 REAL NOT NULL DEFAULT 0,
			p75 REAL NOT NULL DEFAULT 0,
			p90 REAL NOT NULL DEFAULT 0,
			std_dev REAL NOT NULL DEFAULT 0,
			probability_below_zero REAL NOT NULL DEFAULT 0,
			PRIMARY KEY(user_id, id)
		)`,
		`CREATE INDEX IF NOT EXISTS monte_carlo_statistics_slice ON monte_carlo_statistics(user_id, projection_slice_id, account_id, as_of_at)`,
		`CREATE TABLE IF NOT EXISTS projection_rows (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_slice_id TEXT NOT NULL,
			date TEXT NOT NULL,
			payload TEXT NOT NULL,
			PRIMARY KEY(user_id, projection_slice_id, date)
		)`,
		`CREATE TABLE IF NOT EXISTS net_worth_threshold_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			reached INTEGER,
			first_reached_date TEXT,
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS account_balance_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			reached INTEGER,
			first_reached_date TEXT,
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_fulfillment_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			requested_amount REAL,
			realized_amount REAL,
			destination_limited_amount REAL,
			unfulfilled_amount REAL,
			completion_rate REAL,
			first_underfulfilled_date TEXT,
			events_json TEXT NOT NULL DEFAULT '[]',
			dates_json TEXT NOT NULL DEFAULT '[]',
			transactions_json TEXT NOT NULL DEFAULT '[]',
			prob_run_count INTEGER,
			prob_fulfilled_count INTEGER,
			prob_full_probability REAL,
			prob_unfulfilled_p10 REAL,
			prob_unfulfilled_p25 REAL,
			prob_unfulfilled_p50 REAL,
			prob_unfulfilled_p75 REAL,
			prob_unfulfilled_p90 REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS cycle_fulfillment_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			account_ids_json TEXT NOT NULL DEFAULT '[]',
			statement_day INTEGER,
			budget REAL,
			cycle_start TEXT,
			cycle_end TEXT,
			window_start TEXT,
			days_total INTEGER,
			days_left INTEGER,
			recorded_spend REAL,
			scheduled_spend REAL,
			spent REAL,
			remaining REAL,
			within_budget INTEGER,
			shortfall REAL,
			prob_run_count INTEGER,
			prob_within_count INTEGER,
			prob_within_probability REAL,
			prob_spent_p10 REAL,
			prob_spent_p25 REAL,
			prob_spent_p50 REAL,
			prob_spent_p75 REAL,
			prob_spent_p90 REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS planned_purchases_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			all_funded INTEGER,
			first_reached_date TEXT,
			purchases_json TEXT NOT NULL DEFAULT '[]',
			prob_probability REAL,
			prob_p10_date TEXT,
			prob_median_date TEXT,
			prob_p90_date TEXT,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS financial_independence_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			first_coverage_date TEXT,
			first_self_sustaining_date TEXT,
			detail_json TEXT NOT NULL DEFAULT '{}',
			prob_success REAL,
			prob_median_date TEXT,
			prob_self_sustaining_date TEXT,
			prob_self_sustaining_prob REAL,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS whatif_outputs (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			projection_state_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			diagnostics_json TEXT NOT NULL DEFAULT '[]',
			built_revision INTEGER NOT NULL DEFAULT 0,
			has_deterministic INTEGER NOT NULL DEFAULT 0,
			has_probabilistic INTEGER NOT NULL DEFAULT 0,
			final_net_worth REAL,
			transaction_count INTEGER,
			first_unfulfilled_date TEXT,
			all_funded INTEGER,
			prob_full_probability REAL,
			prob_sample_count INTEGER,
			PRIMARY KEY(user_id, projection_state_id, kind, instance_id)
		)`,
		`CREATE TABLE IF NOT EXISTS user_groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_by_user_id TEXT NOT NULL REFERENCES users(id),
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS group_members (
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id),
			role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
			joined_at INTEGER NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(group_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS group_members_account ON group_members(user_id, group_id)`,
		`CREATE TABLE IF NOT EXISTS group_invites (
			id TEXT PRIMARY KEY,
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			code_hash TEXT NOT NULL UNIQUE,
			created_by_user_id TEXT NOT NULL REFERENCES users(id),
			expires_at INTEGER NOT NULL,
			max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
			used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
			revoked_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS friendships (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			display_name TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, friend_user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS friendships_account ON friendships(friend_user_id, user_id)`,
	}
	return append(append(append(append(append(statements, sharingSchemaStatements()...), inboxSchemaStatements()...), sharingRequestsSchemaStatements()...), splitSchemaStatements()...), settlementSchemaStatements()...)
}

// seedAmountPresets is the factory default recipe list. It runs once on a
// fresh plan; afterwards presets are ordinary rows the user owns.
func seedAmountPresets() []types.AmountPreset {
	fixed := func(expression string) types.TransactionAmountResolution {
		return types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
			Amount: types.TransactionAmountResolution{
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
	"transaction_source_facts":        "user_id, transaction_id, facts_json",
	"analysis_inputs":                 "user_id, revision",
	"analysis_runs":                   "user_id, id, type, version, input_revision, state, started_at, completed_at, lease_until, problem, input_json",
	"analysis_findings":               "user_id, id, analysis_type, transaction_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision",
	"analysis_feedback":               "user_id, id, request_id, finding_id, run_id, created_at, payload_json",
	"analysis_promotions":             "user_id, pattern_key, rule_id, created_at",
	"analysis_transfer_links":         "user_id, leg_a, leg_b, finding_id, actor, created_at",
	"analysis_transfer_link_members":  "user_id, transaction_id, leg_a, leg_b",
	"receipts":                        receiptColumns,
	"blob_objects":                    "key, state, expires_at",
	"blob_data":                       "key, data",
	"sessions":                        "token, data, expiry",
	"identity_grants":                 "id, issuer, subject, sid, expiry, data",
	"identity_logout_marks":           "issuer, kind, identifier, seen_at, expiry",
	"identity_logout_tokens":          "issuer, jti, expiry",
	"users":                           "id, issuer, subject",
	"user_groups":                     "id, name, created_by_user_id, created_at",
	"group_members":                   "group_id, user_id, role, joined_at, display_name",
	"group_invites":                   "id, group_id, code_hash, created_by_user_id, expires_at, max_uses, used_count, revoked_at, created_at",
	"sharing_grants":                  "owner_user_id, transaction_id, audience_type, audience_id, intent, created_at",
	"sharing_copies":                  "recipient_user_id, copy_transaction_id, source_owner_id, source_transaction_id, link_id, source_revision, grant_audience_type, grant_audience_id, grant_reason, copied_at, refreshed_at",
	"inbox_share_state":               "recipient_user_id, owner_user_id, transaction_id, status, unread, dismissed, received_at, decided_at, copy_transaction_id",
	"sharing_policies":                "owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at",
	"sharing_visibility":              "owner_user_id, transaction_id, group_id, policy_version, updated_at",
	"sharing_audit":                   "id, owner_user_id, actor_user_id, kind, transaction_id, audience_type, audience_id, group_id, detail_json, created_at",
	"sharing_requests":                "actor_user_id, request_id, action, owner_user_id, transaction_id, audience_type, audience_id, link_id, outcome_json, created_at",
	"splits":                          "split_id, version, source_owner_id, source_transaction_id, source_revision, initiator_id, currency, total_minor, status, created_at, updated_at",
	"split_allocations":               "split_id, version, position, participant_id, amount_minor, accepted, accepted_at",
	"split_settlements":               "settlement_id, split_id, participant_id, amount_minor, linked_owner_id, linked_transaction_id, actor_id, request_id, created_at",
	"split_settlement_requests":       "actor_id, request_id, settlement_id, input_hash, created_at",
	"friendships":                     "user_id, friend_user_id, display_name, created_at",
	"accounts":                        "user_id, id, position, name, kind, min_balance, max_balance, color, enabled",
	"account_displays":                "user_id, account_id, display_json",
	"checkpoints":                     "user_id, id, position, model_account_id, balance, source, provider, observed_at",
	"checkpoint_available_balances":   "user_id, model_account_id, observed_at, available_balance",
	"transactions":                    "user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, projection_slice_id, event_json, applied_amount, outcome",
	"transaction_sim":                 "user_id, transaction_id, position, enabled, execution_order",
	"transaction_claims":              "user_id, transaction_id, fulfills_rule_id, fulfills_occurrence_date",
	"transaction_sync_keys":           "user_id, provider, bridge_account_id, bank_transaction_id, transaction_id",
	"suppressed_sync_keys":            "user_id, provider, bridge_account_id, bank_transaction_id, suppressed_at",
	"schema_migrations":               "name",
	"planned_purchases":               "user_id, id, position, name, funding_account_id, cost, earliest_date, priority, enabled",
	"recurrence_rules":                "user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled",
	"evaluations":                     "user_id, type, instance_id, position, name, enabled, config_json",
	"model_metadata":                  "user_id, id, source_path, document_present",
	"payment_terms":                   "user_id, model_account_id, position, minimum_fixed, minimum_percent, due_day, statement_day",
	"entity_ids":                      "user_id, id, kind",
	"account_links":                   "user_id, bridge_account_id, model_account_id, bridge_name, institution, currency, origin, last_seen_at",
	"pinned_evaluations":              "user_id, instance_id, position",
	"safe_spending_settings":          "user_id, id, settings_json",
	"sync_state":                      "user_id, id, last_sync_at",
	"sync_credentials":                "user_id, id, access_url, bridge_host, updated_at, cards_json",
	"amount_presets":                  "user_id, id, position, name, label, summary, when_use, amount_json, enabled",
	"provider_connections":            "user_id, id, provider_key, status, sync_cursor, last_synced_at",
	"projection_states":               "user_id, id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed, det_evaluations_json, stoch_evaluations_json",
	"projection_slices":               "user_id, id, projection_state_id, from_at, to_at, built_revision, status",
	"monte_carlo_statistics":          "user_id, id, projection_slice_id, account_id, as_of_at, sample_count, mean, median, p10, p25, p50, p75, p90, std_dev, probability_below_zero",
	"projection_rows":                 "user_id, projection_slice_id, date, payload",
	"net_worth_threshold_outputs":     "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date",
	"account_balance_outputs":         "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date",
	"transaction_fulfillment_outputs": "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, requested_amount, realized_amount, destination_limited_amount, unfulfilled_amount, completion_rate, first_underfulfilled_date, events_json, dates_json, transactions_json, prob_run_count, prob_fulfilled_count, prob_full_probability, prob_unfulfilled_p10, prob_unfulfilled_p25, prob_unfulfilled_p50, prob_unfulfilled_p75, prob_unfulfilled_p90",
	"cycle_fulfillment_outputs":       "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, account_ids_json, statement_day, budget, cycle_start, cycle_end, window_start, days_total, days_left, recorded_spend, scheduled_spend, spent, remaining, within_budget, shortfall, prob_run_count, prob_within_count, prob_within_probability, prob_spent_p10, prob_spent_p25, prob_spent_p50, prob_spent_p75, prob_spent_p90",
	"planned_purchases_outputs":       "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, all_funded, first_reached_date, purchases_json, prob_probability, prob_p10_date, prob_median_date, prob_p90_date",
	"financial_independence_outputs":  "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, first_coverage_date, first_self_sustaining_date, detail_json, prob_success, prob_median_date, prob_self_sustaining_date, prob_self_sustaining_prob",
	"whatif_outputs":                  "user_id, projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, final_net_worth, transaction_count, first_unfulfilled_date, all_funded, prob_full_probability, prob_sample_count",
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
	for _, name := range analysisTriggerNames {
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return fmt.Errorf("%w: missing analysis trigger %s", ErrSetupRequired, name)
		}
	}
	return checkReceiptBlobSchemaObjects(db)
}

// expectedSchemaTables lists every table SetupDatabase manages.
func expectedSchemaTables() []string {
	return []string{
		"transaction_source_facts", "analysis_inputs", "analysis_runs", "analysis_findings", "analysis_feedback", "analysis_promotions",
		"analysis_transfer_links", "analysis_transfer_link_members",
		"receipts",
		"blob_objects",
		"blob_data",
		"sessions",
		"identity_grants",
		"identity_logout_marks",
		"identity_logout_tokens",
		"users",
		"user_groups",
		"group_members",
		"group_invites",
		"sharing_grants",
		"sharing_copies",
		"inbox_share_state",
		"sharing_policies",
		"sharing_visibility",
		"sharing_audit",
		"sharing_requests",
		"splits",
		"split_allocations",
		"split_settlements",
		"split_settlement_requests",
		"friendships",
		"accounts",
		"checkpoints",
		"checkpoint_available_balances",
		"transactions",
		"transaction_sim",
		"transaction_claims",
		"transaction_sync_keys",
		"suppressed_sync_keys",
		"transaction_categories",
		"schema_migrations",
		"planned_purchases",
		"recurrence_rules",
		"evaluations",
		"model_metadata",
		"payment_terms",
		"entity_ids",
		"account_links",
		"pinned_evaluations",
		"safe_spending_settings",
		"sync_state",
		"sync_credentials",
		"amount_presets",
		"provider_connections",
		"projection_states",
		"projection_slices",
		"monte_carlo_statistics",
		"projection_rows",
		"net_worth_threshold_outputs",
		"account_balance_outputs",
		"transaction_fulfillment_outputs",
		"cycle_fulfillment_outputs",
		"planned_purchases_outputs",
		"financial_independence_outputs",
		"whatif_outputs",
	}
}
