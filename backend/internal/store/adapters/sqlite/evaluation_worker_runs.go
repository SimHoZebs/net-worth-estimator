package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const evaluationWorkerColumns = `id, type, version, input_revision, fingerprint, state, started_at, completed_at, problem`

func scanEvaluationRun(row interface{ Scan(...any) error }) (types.EvaluationRun, error) {
	var run types.EvaluationRun
	err := row.Scan(&run.ID, &run.Type, &run.Version, &run.InputRevision, &run.Fingerprint, &run.State, &run.StartedAt, &run.CompletedAt, &run.Problem)
	return run, err
}

func evaluationFingerprint(revision int64, detJSON string) string {
	return fmt.Sprintf("%d:%s", revision, detJSON)
}

// ClaimEvaluationWorkerRun claims one worker run for the current projection
// fingerprint with a 60s lease, skipping when already succeeded or when a
// recent failure is still in backoff (30s), and recovering interrupted leases.
func (s *sqliteStore) ClaimEvaluationWorkerRun() (types.EvaluationRun, types.EvaluationSnapshot, bool, error) {
	var run types.EvaluationRun
	var snapshot types.EvaluationSnapshot
	const evalType = "evaluations"
	const evalVersion = "v1"

	tx, err := s.db.Begin()
	if err != nil {
		return run, snapshot, false, err
	}
	defer tx.Rollback()

	var revision int64
	var detJSON string
	err = tx.QueryRow(`SELECT revision, det_evaluations_json FROM projection_states WHERE id = ? AND user_id = :user_id`, defaultProjectionStateID).Scan(&revision, &detJSON)
	if err == sql.ErrNoRows {
		// Fresh user: auto-create defaults so discovery works before first projection.
		fresh := types.UnifiedProjectionDefaults()
		fresh.ID = defaultProjectionStateID
		seed := any(nil)
		if _, execErr := tx.Exec(`INSERT INTO projection_states (id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed, det_evaluations_json, stoch_evaluations_json, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)
			ON CONFLICT(user_id, id) DO NOTHING`,
			fresh.ID, fresh.ScopeID, fresh.Revision, fresh.PublishedRevision, fresh.DirtyFrom, fresh.ProjectionStart, fresh.HorizonEnd, fresh.CalendarTimezone, fresh.EngineVersion, fresh.TrialCount, seed, fresh.DetEvaluationsJSON, fresh.StochEvaluationsJSON); execErr != nil {
			return run, snapshot, false, execErr
		}
		err = tx.QueryRow(`SELECT revision, det_evaluations_json FROM projection_states WHERE id = ? AND user_id = :user_id`, defaultProjectionStateID).Scan(&revision, &detJSON)
		if err != nil {
			return run, snapshot, false, err
		}
	}
	if err != nil {
		return run, snapshot, false, err
	}
	fingerprint := evaluationFingerprint(revision, detJSON)
	now := time.Now().Unix()

	var previous types.EvaluationRun
	err = tx.QueryRow(`SELECT `+evaluationWorkerColumns+` FROM evaluation_worker_runs WHERE user_id = :user_id ORDER BY started_at DESC, id DESC LIMIT 1`).Scan(
		&previous.ID, &previous.Type, &previous.Version, &previous.InputRevision, &previous.Fingerprint, &previous.State, &previous.StartedAt, &previous.CompletedAt, &previous.Problem)
	if err != nil && err != sql.ErrNoRows {
		return run, snapshot, false, err
	}
	if err == nil {
		if previous.State == "running" {
			var lease int64
			if err := tx.QueryRow(`SELECT lease_until FROM evaluation_worker_runs WHERE id = ? AND user_id = :user_id`, previous.ID).Scan(&lease); err != nil {
				return run, snapshot, false, err
			}
			if lease > now {
				return run, snapshot, false, nil
			}
			if _, err := tx.Exec(`UPDATE evaluation_worker_runs SET state = 'failed', problem = 'interrupted', completed_at = ? WHERE id = ? AND user_id = :user_id`, now, previous.ID); err != nil {
				return run, snapshot, false, err
			}
		}
		if previous.InputRevision == revision && previous.Fingerprint == fingerprint && previous.Version == evalVersion {
			if previous.State == "succeeded" || (previous.State == "failed" && now-previous.CompletedAt < 30) {
				return run, snapshot, false, nil
			}
		}
	}

	snapshot = types.EvaluationSnapshot{Revision: revision, Fingerprint: fingerprint, DetEvaluationsJSON: detJSON}
	id, err := newRowID()
	if err != nil {
		return run, snapshot, false, err
	}
	run = types.EvaluationRun{ID: id, Type: evalType, Version: evalVersion, InputRevision: revision, Fingerprint: fingerprint, State: "running", StartedAt: now}
	inputJSON, err := json.Marshal(map[string]any{"revision": revision, "fingerprint": fingerprint, "det_evaluations_json": detJSON})
	if err != nil {
		return run, snapshot, false, err
	}
	if _, err := tx.Exec(`INSERT INTO evaluation_worker_runs(id, type, version, input_revision, fingerprint, state, started_at, lease_until, input_json, user_id) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, :user_id)`, id, evalType, evalVersion, revision, fingerprint, now, now+60, string(inputJSON)); err != nil {
		return run, snapshot, false, err
	}
	return run, snapshot, true, tx.Commit()
}

// CompleteEvaluationWorkerRun publishes the claimed run, marking it
// superseded if the projection revision/fingerprint changed during compute.
func (s *sqliteStore) CompleteEvaluationWorkerRun(run types.EvaluationRun, problem string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stored, err := scanEvaluationRun(tx.QueryRow(`SELECT `+evaluationWorkerColumns+` FROM evaluation_worker_runs WHERE id = ? AND user_id = :user_id`, run.ID))
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if stored.State != "running" {
		return nil
	}
	run = stored

	var revision int64
	var detJSON string
	err = tx.QueryRow(`SELECT revision, det_evaluations_json FROM projection_states WHERE id = ? AND user_id = :user_id`, defaultProjectionStateID).Scan(&revision, &detJSON)
	if err == sql.ErrNoRows {
		// User cleared while computing; drop the run row and exit.
		_, _ = tx.Exec(`DELETE FROM evaluation_worker_runs WHERE id = ? AND user_id = :user_id`, run.ID)
		return tx.Commit()
	}
	if err != nil {
		return err
	}
	fingerprint := evaluationFingerprint(revision, detJSON)
	state, now := "succeeded", time.Now().Unix()
	if problem != "" {
		state, problem = "failed", "evaluation-failed"
	}
	if fingerprint != run.Fingerprint {
		state, problem = "superseded", "inputs-changed"
	}
	if _, err := tx.Exec(`UPDATE evaluation_worker_runs SET state = ?, completed_at = ?, problem = ? WHERE id = ? AND user_id = :user_id`, state, now, problem, run.ID); err != nil {
		return err
	}
	// Keep bounded recent run log.
	if _, err := tx.Exec(`DELETE FROM evaluation_worker_runs WHERE user_id = :user_id AND state != 'running'
		AND id NOT IN (SELECT id FROM evaluation_worker_runs WHERE user_id = :user_id ORDER BY started_at DESC, id DESC LIMIT 128)`); err != nil {
		return err
	}
	return tx.Commit()
}

// ListEvaluationWorkerRuns returns latest run plus current revision/fingerprint.
func (s *sqliteStore) ListEvaluationWorkerRuns() ([]types.EvaluationRun, int64, string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, 0, "", err
	}
	defer tx.Rollback()
	var revision int64
	var detJSON string
	err = tx.QueryRow(`SELECT revision, det_evaluations_json FROM projection_states WHERE id = ? AND user_id = :user_id`, defaultProjectionStateID).Scan(&revision, &detJSON)
	if err == sql.ErrNoRows {
		return []types.EvaluationRun{}, 0, "", nil
	}
	if err != nil {
		return nil, 0, "", err
	}
	fingerprint := evaluationFingerprint(revision, detJSON)
	rows, err := tx.Query(`SELECT ` + evaluationWorkerColumns + ` FROM evaluation_worker_runs WHERE user_id = :user_id AND id = (SELECT id FROM evaluation_worker_runs WHERE user_id = :user_id ORDER BY started_at DESC, id DESC LIMIT 1)`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return []types.EvaluationRun{}, revision, fingerprint, nil
		}
		return nil, 0, "", err
	}
	defer rows.Close()
	result := []types.EvaluationRun{}
	for rows.Next() {
		r, err := scanEvaluationRun(rows)
		if err != nil {
			return nil, 0, "", err
		}
		result = append(result, r)
	}
	return result, revision, fingerprint, rows.Err()
}

// ListEvaluationWorkerUsers discovers users with projection state, without
// requiring a request or sync hook. Matches ListAnalysisUsers discovery.
func (d *Database) ListEvaluationWorkerUsers() ([]string, error) {
	var exists int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projection_states'`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return []string{}, nil
	}
	rows, err := d.db.Query(`SELECT user_id FROM projection_states ORDER BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
