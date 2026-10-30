package sqlite

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *sqliteStore) ListAnalysisFindings(filter types.AnalysisFindingFilter) ([]types.AnalysisFinding, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	query := `SELECT f.id, f.analysis_type, f.detection_json, f.run_id, r.version, r.input_revision,
		f.first_detected_at, f.last_checked_at, f.status, f.dismissed,
		f.status = 'active' AND r.input_revision != COALESCE(i.revision, 0), f.review_json, f.feedback_revision
		FROM analysis_findings f JOIN analysis_runs r ON r.user_id = f.user_id AND r.id = f.run_id
		LEFT JOIN analysis_inputs i ON i.user_id = f.user_id WHERE f.id > ?`
	args := []any{filter.Cursor}
	if len(filter.PostingIDs) > 0 {
		query += ` AND f.posting_id IN (` + strings.TrimSuffix(strings.Repeat("?,", len(filter.PostingIDs)), ",") + `)`
		for _, id := range filter.PostingIDs {
			args = append(args, id)
		}
	}
	query += ` AND f.user_id = :user_id ORDER BY f.id LIMIT ` + strconv.Itoa(limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []types.AnalysisFinding{}
	for rows.Next() {
		var item types.AnalysisFinding
		var raw, reviewJSON string
		if err := rows.Scan(&item.ID, &item.AnalysisType, &raw, &item.RunID, &item.AnalyzerVersion, &item.InputRevision, &item.FirstDetectedAt, &item.LastCheckedAt, &item.Status, &item.Dismissed, &item.Stale, &reviewJSON, &item.FeedbackRevision); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &item.AnalysisDetection); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(reviewJSON), &item.Review); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
