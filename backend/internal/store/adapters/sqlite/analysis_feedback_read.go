package sqlite

import (
	"encoding/json"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *sqliteStore) ListAnalysisFeedback(filter types.AnalysisFeedbackFilter) ([]types.AnalysisFeedback, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	query, args := `SELECT payload_json FROM analysis_feedback WHERE id > ?`, []any{filter.Cursor}
	if filter.FindingID != "" {
		query += ` AND finding_id = ?`
		args = append(args, filter.FindingID)
	}
	query += ` AND user_id = :user_id ORDER BY id LIMIT ` + strconv.Itoa(limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []types.AnalysisFeedback{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item types.AnalysisFeedback
		if err := json.Unmarshal([]byte(raw), &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
