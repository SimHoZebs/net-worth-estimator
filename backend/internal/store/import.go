package store

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ImportCSV seeds the database from a CSV directory, replacing content.
func (s *sqliteStore) ImportCSV(modelPath string) (*types.FinancialModelDocument, error) {
	document, err := csvio.ImportModel(modelPath)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("import begin: %w", err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, document); err != nil {
		return nil, err
	}
	// Rebuild the ID registry from the seed; account links survive a
	// reseed so bridge bindings are not lost.
	if _, err := tx.Exec(`DELETE FROM entity_ids`); err != nil {
		return nil, fmt.Errorf("import clear entity ids: %w", err)
	}
	for _, seed := range []struct {
		kind  string
		query string
	}{
		{"account", `INSERT INTO entity_ids (id, kind) SELECT id, 'account' FROM accounts`},
		{"posting", `INSERT INTO entity_ids (id, kind) SELECT id, 'posting' FROM postings`},
		{"rule", `INSERT INTO entity_ids (id, kind) SELECT id, 'rule' FROM recurrence_rules`},
		{"evaluation", `INSERT INTO entity_ids (id, kind) SELECT instance_id, 'evaluation' FROM evaluations`},
	} {
		if _, err := tx.Exec(seed.query); err != nil {
			return nil, fmt.Errorf("import seed entity ids %s: %w", seed.kind, err)
		}
	}
	storedDocument, err := loadDocument(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("import commit: %w", err)
	}
	return storedDocument, nil
}
