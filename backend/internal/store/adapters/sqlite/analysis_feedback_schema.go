package sqlite

const analysisFeedbackSchema = `CREATE TABLE IF NOT EXISTS analysis_feedback (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL, request_id TEXT NOT NULL, finding_id TEXT NOT NULL, run_id TEXT NOT NULL,
	created_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
	PRIMARY KEY(user_id, id),
	UNIQUE(user_id, request_id),
	FOREIGN KEY(user_id, finding_id) REFERENCES analysis_findings(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, run_id) REFERENCES analysis_runs(user_id, id)
)`

var analysisFeedbackSchemaStatements = []string{
	analysisFeedbackSchema,
	`CREATE INDEX IF NOT EXISTS analysis_feedback_finding ON analysis_feedback(user_id, finding_id, id)`,
	`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('analysis-feedback-v1')`,
}
