package sqlite

import (
	"database/sql"
	"errors"
)

const maxArtifacts = 256

// GetArtifact / PutArtifact retrieve and store completed simulation results.
// Retention is bounded across result kinds by maxArtifacts.
func (s *sqliteStore) GetArtifact(identity string) (string, bool, error) {
	row := s.db.QueryRow(`SELECT payload FROM projection_artifacts WHERE identity = ? AND user_id = :user_id`, identity)
	var payload string
	if err := row.Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return payload, true, nil
}

func (s *sqliteStore) PutArtifact(identity, kind, payload string) error {
	_, err := s.db.Exec(
		`INSERT INTO projection_artifacts (identity, kind, payload, user_id) VALUES (?,?,?, :user_id)
		 ON CONFLICT(user_id, identity) DO NOTHING`,
		identity, kind, payload,
	)
	if err != nil {
		return err
	}
	return evictOldestArtifacts(s.db, maxArtifacts)
}

// evictOldestArtifacts drops the oldest rows beyond the bound regardless of
// kind so stochastic entries cannot grow without bound.
func evictOldestArtifacts(db *userDB, maxArtifacts int) error {
	_, err := db.Exec(`
		DELETE FROM projection_artifacts WHERE user_id = :user_id AND identity IN (
			SELECT identity FROM projection_artifacts WHERE user_id = :user_id
			ORDER BY created_at, identity LIMIT MAX(0, (SELECT COUNT(*) FROM projection_artifacts WHERE user_id = :user_id) - :max_artifacts)
		)`, sql.Named("max_artifacts", maxArtifacts))
	return err
}
