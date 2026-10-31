package sqlite

import (
	"database/sql"
	"errors"
)

const maxArtifacts = 256

// GetArtifact / PutArtifact retrieve and store completed simulation results.
// Retention is bounded per result kind by maxArtifacts, so a burst of one
// kind cannot evict the other kind's stored results.
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
	return evictOldestArtifactsOfKind(s.db, kind, maxArtifacts)
}

// evictOldestArtifactsOfKind drops the oldest rows of one kind beyond the
// bound, leaving other kinds untouched so a burst of range results cannot
// push out the stored projection.
func evictOldestArtifactsOfKind(db *userDB, kind string, maxArtifacts int) error {
	_, err := db.Exec(`
		DELETE FROM projection_artifacts WHERE user_id = :user_id AND kind = :kind AND identity IN (
			SELECT identity FROM projection_artifacts WHERE user_id = :user_id AND kind = :kind
			ORDER BY created_at, identity LIMIT MAX(0, (SELECT COUNT(*) FROM projection_artifacts WHERE user_id = :user_id AND kind = :kind) - :max_artifacts)
		)`, sql.Named("kind", kind), sql.Named("max_artifacts", maxArtifacts))
	return err
}
