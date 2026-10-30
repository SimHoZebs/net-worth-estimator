package sqlite

// preserveAnalysisEvidence follows the import contract: bank postings survive
// replacement, so their source facts and reviewed findings must survive too.
func preserveAnalysisEvidence(tx *userTx) (func() error, error) {
	queries := []struct {
		selectSQL, insertSQL string
		columns              int
	}{
		{`SELECT f.posting_id, f.facts_json FROM transaction_source_facts f JOIN postings p ON p.user_id = f.user_id AND p.id = f.posting_id WHERE f.user_id = :user_id AND p.source != 'user'`,
			`INSERT INTO transaction_source_facts(posting_id, facts_json, user_id) VALUES (?, ?, :user_id)`, 2},
		{`SELECT f.id, f.analysis_type, f.posting_id, f.kind, f.detection_json, f.run_id, f.first_detected_at, f.last_checked_at, f.status, f.dismissed, f.review_json, f.feedback_revision FROM analysis_findings f JOIN postings p ON p.user_id = f.user_id AND p.id = f.posting_id WHERE f.user_id = :user_id AND p.source != 'user'`,
			`INSERT INTO analysis_findings(id, analysis_type, posting_id, kind, detection_json, run_id, first_detected_at, last_checked_at, status, dismissed, review_json, feedback_revision, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`, 12},
		{`SELECT e.id, e.request_id, e.finding_id, e.run_id, e.created_at, e.payload_json FROM analysis_feedback e JOIN analysis_findings f ON f.user_id = e.user_id AND f.id = e.finding_id JOIN postings p ON p.user_id = f.user_id AND p.id = f.posting_id WHERE e.user_id = :user_id AND p.source != 'user'`,
			`INSERT INTO analysis_feedback(id, request_id, finding_id, run_id, created_at, payload_json, user_id) VALUES (?, ?, ?, ?, ?, ?, :user_id)`, 6},
	}
	type savedRow struct {
		query string
		args  []any
	}
	var saved []savedRow
	for _, query := range queries {
		rows, err := tx.Query(query.selectSQL)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			values, pointers := make([]any, query.columns), make([]any, query.columns)
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				rows.Close()
				return nil, err
			}
			saved = append(saved, savedRow{query.insertSQL, values})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return func() error {
		for _, row := range saved {
			if _, err := tx.Exec(row.query, row.args...); err != nil {
				return err
			}
		}
		return nil
	}, nil
}
