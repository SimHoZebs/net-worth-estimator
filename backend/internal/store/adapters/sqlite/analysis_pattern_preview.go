package sqlite

import (
	"database/sql"
	"encoding/json"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// patternPreviewData is the shared read path behind both pattern previews:
// the confirmed anchor finding, its deduped occurrence IDs in evidence
// order, the immutable source facts for those occurrences, and the saved
// model rows behind them. It never writes.
type patternPreviewData struct {
	anchor        types.AnalysisFinding
	occurrenceIDs []string
	facts         map[string]types.TransactionFacts
	model         *types.FinancialModel
}

func (s *sqliteStore) loadPatternPreviewData(findingID string) (patternPreviewData, error) {
	var data patternPreviewData
	var detectionJSON, reviewJSON string
	err := s.db.QueryRow(`SELECT f.id, f.analysis_type, f.detection_json, f.run_id, r.version, r.input_revision,
		f.first_detected_at, f.last_checked_at, f.status, f.dismissed, f.review_json, f.feedback_revision
		FROM analysis_findings f JOIN analysis_runs r ON r.user_id = f.user_id AND r.id = f.run_id
		WHERE f.id = ? AND f.user_id = :user_id`, findingID).Scan(
		&data.anchor.ID, &data.anchor.AnalysisType, &detectionJSON, &data.anchor.RunID, &data.anchor.AnalyzerVersion,
		&data.anchor.InputRevision, &data.anchor.FirstDetectedAt, &data.anchor.LastCheckedAt, &data.anchor.Status,
		&data.anchor.Dismissed, &reviewJSON, &data.anchor.FeedbackRevision)
	if err == sql.ErrNoRows {
		return data, store.ErrNotFound
	}
	if err != nil {
		return data, err
	}
	if err := json.Unmarshal([]byte(detectionJSON), &data.anchor.AnalysisDetection); err != nil {
		return data, err
	}
	if err := json.Unmarshal([]byte(reviewJSON), &data.anchor.Review); err != nil {
		return data, err
	}
	for _, evidence := range data.anchor.Evidence {
		data.occurrenceIDs = append(data.occurrenceIDs, evidence.TransactionIDs...)
	}
	seen := map[string]bool{}
	ordered := data.occurrenceIDs[:0]
	for _, id := range data.occurrenceIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ordered = append(ordered, id)
	}
	data.occurrenceIDs = ordered
	model, err := s.LoadModel()
	if err != nil {
		return data, err
	}
	data.model = model
	data.facts = map[string]types.TransactionFacts{}
	if len(data.occurrenceIDs) > 0 {
		placeholders := ""
		args := make([]any, 0, len(data.occurrenceIDs))
		for i, id := range data.occurrenceIDs {
			if i > 0 {
				placeholders += ","
			}
			placeholders += "?"
			args = append(args, id)
		}
		rows, err := s.db.Query(`SELECT transaction_id, facts_json FROM transaction_source_facts WHERE transaction_id IN (`+placeholders+`) AND user_id = :user_id`, args...)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, raw string
			if err := rows.Scan(&id, &raw); err != nil {
				return data, err
			}
			var item types.TransactionFacts
			if err := json.Unmarshal([]byte(raw), &item); err != nil {
				return data, err
			}
			data.facts[id] = item
		}
		if err := rows.Err(); err != nil {
			return data, err
		}
	}
	return data, nil
}
