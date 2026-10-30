package sqlite

import "database/sql"

const analysisFeedbackSchema = `CREATE TABLE IF NOT EXISTS analysis_feedback (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL, request_id TEXT NOT NULL, finding_id TEXT NOT NULL, run_id TEXT NOT NULL,
	created_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
	PRIMARY KEY(user_id, id),
	UNIQUE(user_id, request_id),
	FOREIGN KEY(user_id, finding_id) REFERENCES analysis_findings(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, run_id) REFERENCES analysis_runs(user_id, id)
)`

func setupAnalysisFeedback(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(analysis_findings)`)
	if err != nil {
		return err
	}
	columns := map[string]bool{}
	for rows.Next() {
		var cid, notNull, pk int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			rows.Close()
			return err
		}
		columns[name] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, column := range []struct{ name, ddl string }{
		{"review_json", `ALTER TABLE analysis_findings ADD COLUMN review_json TEXT NOT NULL DEFAULT 'null'`},
		{"feedback_revision", `ALTER TABLE analysis_findings ADD COLUMN feedback_revision INTEGER NOT NULL DEFAULT 0`},
	} {
		if !columns[column.name] {
			if _, err := tx.Exec(column.ddl); err != nil {
				return err
			}
		}
	}
	for _, statement := range []string{analysisFeedbackSchema,
		`CREATE INDEX IF NOT EXISTS analysis_feedback_finding ON analysis_feedback(user_id, finding_id, id)`,
		`INSERT OR IGNORE INTO schema_migrations(name) VALUES ('analysis-feedback-v1')`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}
