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
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE account_id = :account_id`); err != nil {
		return nil, fmt.Errorf("import clear entity ids: %w", err)
	}
	for _, seed := range []struct {
		kind  string
		query string
	}{
		{"account", `INSERT INTO entity_ids (id, kind, account_id) SELECT id, 'account', :account_id FROM accounts WHERE account_id = :account_id`},
		{"posting", `INSERT INTO entity_ids (id, kind, account_id) SELECT id, 'posting', :account_id FROM postings WHERE account_id = :account_id`},
		{"rule", `INSERT INTO entity_ids (id, kind, account_id) SELECT id, 'rule', :account_id FROM recurrence_rules WHERE account_id = :account_id`},
		{"evaluation", `INSERT INTO entity_ids (id, kind, account_id) SELECT instance_id, 'evaluation', :account_id FROM evaluations WHERE account_id = :account_id`},
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
