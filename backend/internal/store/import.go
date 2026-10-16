package store

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ImportCSV seeds the database from CSV directories, replacing content.
func (s *sqliteStore) ImportCSV(modelPath, incomePath string) (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error) {
	document, err := csvio.ImportModel(modelPath)
	if err != nil {
		return nil, nil, err
	}
	incomeData, err := csvio.ImportIncomeData(incomePath)
	if err != nil {
		return nil, nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, fmt.Errorf("import begin: %w", err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, document); err != nil {
		return nil, nil, err
	}
	// Rebuild the ID registry from the seed; account links survive a
	// reseed so bridge bindings are not lost.
	if _, err := tx.Exec(`DELETE FROM entity_ids`); err != nil {
		return nil, nil, fmt.Errorf("import clear entity ids: %w", err)
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
			return nil, nil, fmt.Errorf("import seed entity ids %s: %w", seed.kind, err)
		}
	}
	if err := replaceIncomeData(tx, incomeData); err != nil {
		return nil, nil, err
	}
	storedDocument, err := loadDocument(tx)
	if err != nil {
		return nil, nil, err
	}
	storedIncomeData, err := loadIncomeData(tx)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("import commit: %w", err)
	}
	return storedDocument, storedIncomeData, nil
}
