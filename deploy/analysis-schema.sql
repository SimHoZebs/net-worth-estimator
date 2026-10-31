-- Frozen DDL for the pending offline deployment operation, not application setup.
.bail on
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE transaction_source_facts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posting_id TEXT NOT NULL, facts_json TEXT NOT NULL,
  PRIMARY KEY(user_id, posting_id),
  FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE
);
CREATE TABLE analysis_inputs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE analysis_runs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, type TEXT NOT NULL, version TEXT NOT NULL,
  input_revision INTEGER NOT NULL, state TEXT NOT NULL,
  started_at INTEGER NOT NULL, completed_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL, problem TEXT NOT NULL DEFAULT '', input_json TEXT NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX analysis_runs_latest ON analysis_runs(user_id, type, started_at DESC, id DESC);
CREATE TABLE analysis_findings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, analysis_type TEXT NOT NULL, posting_id TEXT NOT NULL,
  kind TEXT NOT NULL, detection_json TEXT NOT NULL, run_id TEXT NOT NULL,
  first_detected_at INTEGER NOT NULL, last_checked_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'withdrawn')),
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
  review_json TEXT NOT NULL DEFAULT 'null',
  feedback_revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, id), UNIQUE(user_id, analysis_type, posting_id, kind),
  FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, run_id) REFERENCES analysis_runs(user_id, id)
);
CREATE INDEX analysis_findings_posting ON analysis_findings(user_id, posting_id, id);
CREATE TABLE analysis_feedback (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, request_id TEXT NOT NULL, finding_id TEXT NOT NULL, run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(user_id, id), UNIQUE(user_id, request_id),
  FOREIGN KEY(user_id, finding_id) REFERENCES analysis_findings(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, run_id) REFERENCES analysis_runs(user_id, id)
);
CREATE INDEX analysis_feedback_finding ON analysis_feedback(user_id, finding_id, id);
CREATE TRIGGER analysis_facts_insert AFTER INSERT ON transaction_source_facts BEGIN
  INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER analysis_facts_update AFTER UPDATE ON transaction_source_facts BEGIN
  INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER analysis_facts_delete AFTER DELETE ON transaction_source_facts BEGIN
  INSERT INTO analysis_inputs(user_id, revision) VALUES (OLD.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER IF NOT EXISTS analysis_posting_lifecycle AFTER UPDATE OF pending, void ON postings
  WHEN (OLD.pending != NEW.pending OR OLD.void != NEW.void)
  AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND posting_id = NEW.id)
  BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END;
CREATE TRIGGER IF NOT EXISTS analysis_posting_sim_lifecycle AFTER UPDATE OF enabled ON posting_sim
  WHEN (OLD.enabled != NEW.enabled)
  AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND posting_id = NEW.posting_id)
  BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END;
INSERT INTO schema_migrations(name) VALUES ('transaction-analysis-v1'), ('analysis-feedback-v1');
COMMIT;
