package store

import "fmt"

// InitializeDocument activates a blank model if absent. Existing rows, metadata,
// sync state, and artifacts stay unchanged. Repeated calls are safe.
func (s *sqliteStore) InitializeDocument() error {
	if _, err := s.db.Exec(`UPDATE model_metadata SET document_present = 1 WHERE id = 1 AND document_present = 0 AND plan_id = :plan_id`); err != nil {
		return fmt.Errorf("initialize model: %w", err)
	}
	return nil
}
