package dbmigration

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

var identityTables = []string{"sessions", "identity_grants", "identity_logout_marks", "identity_logout_tokens"}

func migrateIdentity(db *store.Database, src *snapshot, r *Report) error {
	if err := validateTables(src, identityTables); err != nil {
		return fmt.Errorf("identity source: %w", err)
	}
	tx, err := db.SQL().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range identityTables {
		n, err := copyTable(src.tx, tx, table, "")
		if err != nil {
			return fmt.Errorf("identity source: %w", err)
		}
		r.IdentityRows += n
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit identity data")
	}
	return nil
}
