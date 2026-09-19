package store

import (
	"database/sql"
	"errors"
)

const maxArtifacts = 256

// GetArtifact / PutArtifact implement the bounded artifact cache.
func (s *Store) GetArtifact(identity string) (string, bool, error) {
	row := s.db.QueryRow(`SELECT payload FROM projection_artifacts WHERE identity = ?`, identity)
	var payload string
	if err := row.Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return payload, true, nil
}

func (s *Store) PutArtifact(identity, kind, payload string) error {
	_, err := s.db.Exec(
		`INSERT INTO projection_artifacts (identity, kind, payload) VALUES (?,?,?)
		 ON CONFLICT(identity) DO NOTHING`,
		identity, kind, payload,
	)
	if err != nil {
		return err
	}
	return evictOldestArtifacts(s.db, maxArtifacts)
}

// evictOldestArtifacts drops the oldest rows beyond the bound regardless of
// kind so stochastic entries cannot grow without bound.
func evictOldestArtifacts(db *sql.DB, maxArtifacts int) error {
	_, err := db.Exec(`
		DELETE FROM projection_artifacts WHERE identity IN (
			SELECT identity FROM projection_artifacts
			ORDER BY created_at LIMIT MAX(0, (SELECT COUNT(*) FROM projection_artifacts) - ?)
		)`, maxArtifacts)
	return err
}
