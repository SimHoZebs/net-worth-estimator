package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"

	_ "modernc.org/sqlite"
)

var (
	_ store.Store    = (*sqliteStore)(nil)
	_ store.Database = (*Database)(nil)
)

// sqliteStore is the embedded-SQLite Store implementation. Pure-Go driver
// (modernc), single file, WAL mode, one open connection.
type sqliteStore struct {
	db          *userDB
	owned       *Database
	application *Database
}

// Open creates or opens an ordinary isolated user scope for tests and
// fixture tools. Runtime callers must use OpenDatabase. Incompatible
// databases are rejected and never converted here.
func Open(path string) (store.Store, error) {
	db, err := SetupDatabase(path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	const issuer, subject = "https://issuer.test", "sqlite-open-test"
	st, err := db.ensureUser(authorization.ActorKey(issuer, subject), issuer, subject)
	if err != nil {
		db.Close()
		return nil, err
	}
	st.(*sqliteStore).owned = db
	return st, nil
}

// Close releases an owned isolated database. Shared user handles never close it.
func (s *sqliteStore) Close() error {
	if s.owned != nil {
		return s.owned.Close()
	}
	return nil
}

// Clear removes all canonical model rows (used by tests/import).
func (s *sqliteStore) Clear() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("clear begin: %w", err)
	}
	defer tx.Rollback()
	if err := clearModel(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("clear commit: %w", err)
	}
	return nil
}
