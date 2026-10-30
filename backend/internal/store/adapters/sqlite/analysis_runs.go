package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const analysisRunColumns = `id, type, version, input_revision, state, started_at, completed_at, problem`

func scanAnalysisRun(row interface{ Scan(...any) error }) (types.AnalysisRun, error) {
	var run types.AnalysisRun
	err := row.Scan(&run.ID, &run.Type, &run.Version, &run.InputRevision, &run.State, &run.StartedAt, &run.CompletedAt, &run.Problem)
	return run, err
}

func (s *sqliteStore) ClaimAnalysis(kind, version string) (types.AnalysisRun, types.AnalysisSnapshot, bool, error) {
	var run types.AnalysisRun
	var input types.AnalysisSnapshot
	if kind == "" || version == "" {
		return run, input, false, errors.New("analysis requires type and version")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return run, input, false, err
	}
	defer tx.Rollback()
	revision, err := analysisRevision(tx)
	if err != nil {
		return run, input, false, err
	}
	now := time.Now().Unix()
	previous, err := scanAnalysisRun(tx.QueryRow(`SELECT `+analysisRunColumns+` FROM analysis_runs WHERE type = ? AND user_id = :user_id ORDER BY started_at DESC, id DESC LIMIT 1`, kind))
	if err != nil && err != sql.ErrNoRows {
		return run, input, false, err
	}
	if err == nil {
		if previous.State == "running" {
			var lease int64
			if err := tx.QueryRow(`SELECT lease_until FROM analysis_runs WHERE id = ? AND user_id = :user_id`, previous.ID).Scan(&lease); err != nil {
				return run, input, false, err
			}
			if lease > now {
				return run, input, false, nil
			}
			if _, err := tx.Exec(`UPDATE analysis_runs SET state = 'failed', problem = 'interrupted', completed_at = ? WHERE id = ? AND user_id = :user_id`, now, previous.ID); err != nil {
				return run, input, false, err
			}
		}
		if previous.InputRevision == revision && previous.Version == version {
			if previous.State == "succeeded" || (previous.State == "failed" && now-previous.CompletedAt < 30) {
				return run, input, false, nil
			}
		}
	}
	input, err = loadAnalysisSnapshot(tx, revision)
	if err != nil {
		return run, input, false, err
	}
	id, err := newRowID()
	if err != nil {
		return run, input, false, err
	}
	run = types.AnalysisRun{ID: id, Type: kind, Version: version, InputRevision: revision, State: "running", StartedAt: now}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return run, input, false, err
	}
	if _, err := tx.Exec(`INSERT INTO analysis_runs(id, type, version, input_revision, state, started_at, lease_until, input_json, user_id) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, :user_id)`, id, kind, version, revision, now, now+60, string(inputJSON)); err != nil {
		return run, input, false, err
	}
	return run, input, true, tx.Commit()
}

func (s *sqliteStore) CompleteAnalysis(run types.AnalysisRun, findings []types.AnalysisDetection, problem string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Read the claimed descriptor from storage. A caller cannot change its scope,
	// algorithm, revision, or finished state by modifying the run value.
	stored, err := scanAnalysisRun(tx.QueryRow(`SELECT `+analysisRunColumns+` FROM analysis_runs WHERE id = ? AND user_id = :user_id`, run.ID))
	if err == sql.ErrNoRows {
		return nil
	} // A clear removed the run while computation was outside the transaction.
	if err != nil {
		return err
	}
	if stored.State != "running" {
		return nil
	}
	run = stored
	revision, err := analysisRevision(tx)
	if err != nil {
		return err
	}
	state, now := "succeeded", time.Now().Unix()
	if problem != "" {
		state = "failed"
		problem = "analysis-failed"
	}
	if revision != run.InputRevision {
		state, problem = "superseded", "inputs-changed"
	}
	if state == "succeeded" {
		if _, err := tx.Exec(`UPDATE analysis_findings SET status = 'withdrawn', last_checked_at = ? WHERE analysis_type = ? AND user_id = :user_id`, now, run.Type); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, item := range findings {
			key := item.PostingID + "\x00" + item.Kind
			if item.PostingID == "" || item.Kind == "" || seen[key] {
				return fmt.Errorf("invalid or duplicate analysis finding")
			}
			seen[key] = true
			var exists int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM transaction_source_facts WHERE posting_id = ? AND user_id = :user_id`, item.PostingID).Scan(&exists); err != nil {
				return err
			}
			if exists != 1 {
				return fmt.Errorf("finding does not reference this user's source evidence")
			}
			data, err := json.Marshal(item)
			if err != nil {
				return err
			}
			id, err := newRowID()
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO analysis_findings(id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, user_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', :user_id)
				ON CONFLICT(user_id, analysis_type, posting_id, kind) DO UPDATE SET detection_json = excluded.detection_json, run_id = excluded.run_id, last_checked_at = excluded.last_checked_at, status = 'active'`,
				id, run.Type, item.PostingID, item.Kind, string(data), run.ID, now, now); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`UPDATE analysis_runs SET state = ?, completed_at = ?, problem = ? WHERE id = ? AND user_id = :user_id`, state, now, problem, run.ID); err != nil {
		return err
	}
	// Keep a bounded recent run log. Runs still referenced by findings survive.
	if _, err := tx.Exec(`DELETE FROM analysis_runs WHERE user_id = :user_id AND state != 'running'
		AND id NOT IN (SELECT id FROM analysis_runs WHERE user_id = :user_id ORDER BY started_at DESC, id DESC LIMIT 128)
		AND NOT EXISTS(SELECT 1 FROM analysis_findings f WHERE f.user_id = analysis_runs.user_id AND f.run_id = analysis_runs.id)
		AND NOT EXISTS(SELECT 1 FROM analysis_feedback f WHERE f.user_id = analysis_runs.user_id AND f.run_id = analysis_runs.id)`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *sqliteStore) ListAnalysisRuns() ([]types.AnalysisRun, int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()
	revision, err := analysisRevision(tx)
	if err != nil {
		return nil, 0, err
	}
	rows, err := tx.Query(`SELECT ` + analysisRunColumns + ` FROM analysis_runs r WHERE user_id = :user_id AND id = (SELECT id FROM analysis_runs latest WHERE latest.user_id = r.user_id AND latest.type = r.type ORDER BY started_at DESC, id DESC LIMIT 1) ORDER BY type`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := []types.AnalysisRun{}
	for rows.Next() {
		run, err := scanAnalysisRun(rows)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, run)
	}
	return result, revision, rows.Err()
}
