package sqlite

import "strings"

var analysisSchema = []string{
	`CREATE TABLE IF NOT EXISTS transaction_source_facts (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		transaction_id TEXT NOT NULL, facts_json TEXT NOT NULL,
		PRIMARY KEY(user_id, transaction_id),
		FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
	)`,
	`CREATE TABLE IF NOT EXISTS analysis_inputs (
		user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		revision INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS analysis_runs (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		id TEXT NOT NULL, type TEXT NOT NULL, version TEXT NOT NULL,
		input_revision INTEGER NOT NULL, state TEXT NOT NULL,
		started_at INTEGER NOT NULL, completed_at INTEGER NOT NULL DEFAULT 0,
		lease_until INTEGER NOT NULL, problem TEXT NOT NULL DEFAULT '', input_json TEXT NOT NULL,
		PRIMARY KEY(user_id, id)
	)`,
	`CREATE INDEX IF NOT EXISTS analysis_runs_latest ON analysis_runs(user_id, type, started_at DESC, id DESC)`,
	`CREATE TABLE IF NOT EXISTS analysis_findings (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		id TEXT NOT NULL, analysis_type TEXT NOT NULL, transaction_id TEXT NOT NULL,
		kind TEXT NOT NULL, detection_json TEXT NOT NULL, run_id TEXT NOT NULL,
		first_detected_at INTEGER NOT NULL, last_checked_at INTEGER NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('active', 'withdrawn')),
		dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
		review_json TEXT NOT NULL DEFAULT 'null',
		feedback_revision INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY(user_id, id), UNIQUE(user_id, analysis_type, transaction_id, kind),
		FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE,
		FOREIGN KEY(user_id, run_id) REFERENCES analysis_runs(user_id, id)
	)`,
	`CREATE INDEX IF NOT EXISTS analysis_findings_transaction ON analysis_findings(user_id, transaction_id, id)`,
	`CREATE TABLE IF NOT EXISTS analysis_promotions (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		pattern_key TEXT NOT NULL, rule_id TEXT NOT NULL, created_at INTEGER NOT NULL,
		PRIMARY KEY(user_id, pattern_key)
	)`,
	analysisTransferLinksDDL,
	analysisTransferLinkMembersDDL,
	analysisFactDirtyDDL,
	analysisPaymentStreamsDDL,
}

// analysisFactDirtyDDL is the durable dirty set for incremental payment
// streams: one row per changed bank fact with the revision that changed it.
// Tombstones have no foreign key so deletes survive the row delete. Fresh
// databases get it from the shared schema; pre-existing databases gain it
// on first incremental use, so no operator migration converts anything.
const analysisFactDirtyDDL = `CREATE TABLE IF NOT EXISTS analysis_fact_dirty (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL,
	revision INTEGER NOT NULL,
	kind TEXT NOT NULL,
	PRIMARY KEY(user_id, transaction_id)
)`

// analysisPaymentStreamsDDL is the durable payment-stream cache: one row per
// stream with opaque stats, member bank fact IDs, the consumed analysis
// revision, and the identity version. Fresh databases get it from the shared
// schema; pre-existing databases gain it on first incremental use.
const analysisPaymentStreamsDDL = `CREATE TABLE IF NOT EXISTS analysis_payment_streams (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	stream_id TEXT NOT NULL,
	stats_json TEXT NOT NULL DEFAULT '{}',
	member_ids_json TEXT NOT NULL DEFAULT '[]',
	consumed_revision INTEGER NOT NULL DEFAULT 0,
	identity_version INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(user_id, stream_id)
)`

var analysisTriggerNames = []string{"analysis_facts_insert", "analysis_facts_update", "analysis_facts_delete", "analysis_transaction_lifecycle", "analysis_transaction_sim_lifecycle"}

func analysisSchemaStatements() []string {
	statements := append([]string(nil), analysisSchema...)
	for _, ddl := range incrementalTriggerDDLs() {
		statements = append(statements, strings.Replace(ddl, "CREATE TRIGGER ", "CREATE TRIGGER IF NOT EXISTS ", 1))
	}
	return append(statements, `CREATE TRIGGER IF NOT EXISTS analysis_transaction_sim_lifecycle AFTER UPDATE OF enabled ON transaction_sim
		WHEN (OLD.enabled != NEW.enabled)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND transaction_id = NEW.transaction_id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`,
		`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('transaction-analysis-v1')`,
		`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('analysis-transfer-links-v1')`)
}
