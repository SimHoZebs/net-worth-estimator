package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CompleteAnalysisPaymentStreams publishes one incremental payments run.
// Findings for recomputed streams reconcile exactly like CompleteAnalysis
// (review, dismissal, and identity preserved by the same upsert); withdrawal
// applies only within recomputed streams, and every other finding row stays
// untouched, including its check timestamp. The stream cache upserts and
// deletes land in the same transaction, and every cached entry advances its
// consumed revision to the published run revision. Run-state guards
// (missing or finished runs, failure mapping, supersede on changed inputs,
// bounded run log) match CompleteAnalysis.
func (s *sqliteStore) CompleteAnalysisPaymentStreams(run types.AnalysisRun, publish store.AnalysisPaymentPublish) error {
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
	problem := publish.Problem
	if problem != "" && !types.RetryableJudgmentProblem(problem) {
		state = "failed"
		problem = "analysis-failed"
	}
	if revision != run.InputRevision {
		state, problem = "superseded", "inputs-changed"
	}
	if state == "succeeded" {
		recomputed := map[string]bool{}
		for _, streamID := range publish.RecomputedStreamIDs {
			if streamID != "" {
				recomputed[streamID] = true
			}
		}
		if len(recomputed) > 0 {
			ordered := make([]string, 0, len(recomputed))
			for streamID := range recomputed {
				ordered = append(ordered, streamID)
			}
			sort.Strings(ordered)
			placeholders := make([]string, 0, len(ordered))
			args := []any{now, run.Type}
			for _, streamID := range ordered {
				placeholders = append(placeholders, "?")
				args = append(args, streamID)
			}
			if _, err := tx.Exec(`UPDATE analysis_findings SET status = 'withdrawn', last_checked_at = ? WHERE analysis_type = ? AND user_id = :user_id AND json_extract(detection_json, '$.streamId') IN (`+strings.Join(placeholders, ",")+`)`, args...); err != nil {
				return err
			}
		}
		seen := map[string]bool{}
		var carried []types.AnalysisDetection
		for _, item := range publish.Findings {
			key := item.TransactionID + "\x00" + item.Kind
			if item.TransactionID == "" || item.Kind == "" || seen[key] {
				return fmt.Errorf("invalid or duplicate analysis finding")
			}
			seen[key] = true
			// Carried-forward findings for untouched streams skip
			// reconciliation; their detection bytes stay identical and
			// re-attribute to this run below.
			if !recomputed[item.StreamID] {
				carried = append(carried, item)
				continue
			}
			var exists int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM transaction_source_facts WHERE transaction_id = ? AND user_id = :user_id`, item.TransactionID).Scan(&exists); err != nil {
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
			if _, err := tx.Exec(`INSERT INTO analysis_findings(id, analysis_type, transaction_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, user_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', :user_id)
				ON CONFLICT(user_id, analysis_type, transaction_id, kind) DO UPDATE SET detection_json = excluded.detection_json, run_id = excluded.run_id, last_checked_at = excluded.last_checked_at, status = 'active'`,
				id, run.Type, item.TransactionID, item.Kind, string(data), run.ID, now, now); err != nil {
				return err
			}
		}
		for _, item := range carried {
			if _, err := tx.Exec(`UPDATE analysis_findings SET run_id = ?, last_checked_at = ? WHERE analysis_type = ? AND transaction_id = ? AND kind = ? AND user_id = :user_id`, run.ID, now, run.Type, item.TransactionID, item.Kind); err != nil {
				return err
			}
		}
		for _, stream := range publish.UpsertStreams {
			if stream.StreamID == "" {
				return fmt.Errorf("payment stream requires an ID")
			}
			members, err := json.Marshal(stream.MemberTransactionIDs)
			if err != nil {
				return fmt.Errorf("encode stream members %s: %w", stream.StreamID, err)
			}
			stats := stream.StatsJSON
			if stats == "" {
				stats = "{}"
			}
			if !json.Valid([]byte(stats)) {
				return fmt.Errorf("payment stream %s carries invalid stats JSON", stream.StreamID)
			}
			if _, err := tx.Exec(`INSERT INTO analysis_payment_streams(stream_id, stats_json, member_ids_json, consumed_revision, identity_version, user_id)
				VALUES (?, ?, ?, ?, ?, :user_id)
				ON CONFLICT(user_id, stream_id) DO UPDATE SET stats_json = excluded.stats_json, member_ids_json = excluded.member_ids_json,
					consumed_revision = excluded.consumed_revision, identity_version = excluded.identity_version`,
				stream.StreamID, stats, string(members), stream.ConsumedRevision, stream.IdentityVersion); err != nil {
				return err
			}
		}
		for _, streamID := range publish.DeleteStreamIDs {
			if _, err := tx.Exec(`DELETE FROM analysis_payment_streams WHERE stream_id = ? AND user_id = :user_id`, streamID); err != nil {
				return fmt.Errorf("delete payment stream %s: %w", streamID, err)
			}
		}
		if _, err := tx.Exec(`UPDATE analysis_payment_streams SET consumed_revision = ? WHERE user_id = :user_id`, run.InputRevision); err != nil {
			return err
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
