package store

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ImportCSV seeds the database from CSV directories, replacing content.
func (s *Store) ImportCSV(modelPath, incomePath string) (*types.FinancialModelDocument, *types.IncomeDataSnapshot, error) {
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
