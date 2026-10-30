package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ImportModel seeds the database from a canonical model, replacing content.
func (s *sqliteStore) ImportModel(model *types.FinancialModel) (*types.FinancialModel, error) {
	if model == nil {
		return nil, fmt.Errorf("import model is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("import begin: %w", err)
	}
	defer tx.Rollback()
	if err := replaceModel(tx, model); err != nil {
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
		{"planned-purchase", `INSERT INTO entity_ids (id, kind, user_id) SELECT id, 'planned-purchase', :user_id FROM planned_purchases WHERE user_id = :user_id`},
		{"rule", `INSERT INTO entity_ids (id, kind, user_id) SELECT id, 'rule', :user_id FROM recurrence_rules WHERE user_id = :user_id`},
		{"evaluation", `INSERT INTO entity_ids (id, kind, user_id) SELECT instance_id, 'evaluation', :user_id FROM evaluations WHERE user_id = :user_id`},
	} {
		if _, err := tx.Exec(seed.query); err != nil {
			return nil, fmt.Errorf("import seed entity ids %s: %w", seed.kind, err)
		}
	}
	storedModel, err := loadModel(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("import commit: %w", err)
	}
	return storedModel, nil
}
