package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ImportDocument seeds the database from a canonical document, replacing content.
func (s *sqliteStore) ImportDocument(document *types.FinancialModelDocument) (*types.FinancialModelDocument, error) {
	if document == nil {
		return nil, fmt.Errorf("import document is required")
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
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE user_id = :user_id`); err != nil {
		return nil, fmt.Errorf("import clear entity ids: %w", err)
	}
	for _, seed := range []struct {
		kind  string
		query string
	}{
		{"account", `INSERT INTO entity_ids (id, kind, user_id) SELECT id, 'account', :user_id FROM accounts WHERE user_id = :user_id`},
		{"posting", `INSERT INTO entity_ids (id, kind, user_id) SELECT id, 'posting', :user_id FROM postings WHERE user_id = :user_id`},
		{"rule", `INSERT INTO entity_ids (id, kind, user_id) SELECT id, 'rule', :user_id FROM recurrence_rules WHERE user_id = :user_id`},
		{"evaluation", `INSERT INTO entity_ids (id, kind, user_id) SELECT instance_id, 'evaluation', :user_id FROM evaluations WHERE user_id = :user_id`},
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
