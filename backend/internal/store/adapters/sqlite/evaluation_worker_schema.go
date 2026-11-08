package sqlite

// evaluationWorkerSchema provisions worker tables for async evaluation
// execution. Discovery reuses projection_states (SELECT user_id FROM
// projection_states); no dedicated inputs table is needed. Runs table
// is pruned to latest 128 on complete, mirroring analysis_runs retention.
var evaluationWorkerSchema = []string{
	`CREATE TABLE IF NOT EXISTS evaluation_worker_runs (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		id TEXT NOT NULL, type TEXT NOT NULL, version TEXT NOT NULL,
		input_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL DEFAULT '',
		state TEXT NOT NULL,
		started_at INTEGER NOT NULL, completed_at INTEGER NOT NULL DEFAULT 0,
		lease_until INTEGER NOT NULL, problem TEXT NOT NULL DEFAULT '', input_json TEXT NOT NULL DEFAULT '{}',
		PRIMARY KEY(user_id, id)
	)`,
	`CREATE INDEX IF NOT EXISTS evaluation_worker_runs_latest ON evaluation_worker_runs(user_id, started_at DESC, id DESC)`,
}

func evaluationWorkerSchemaStatements() []string {
	return append([]string(nil), evaluationWorkerSchema...)
}
