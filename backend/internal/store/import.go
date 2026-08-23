package store

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
)

// ImportCSV seeds the database from CSV directories, replacing content.
func (s *Store) ImportCSV(modelPath, incomePath string) error {
	document, err := csvio.ImportModel(modelPath)
	if err != nil {
		return err
	}
	if err := s.SaveDocument(document); err != nil {
		return err
	}
	incomeData, err := csvio.ImportIncomeData(incomePath)
	if err != nil {
		return err
	}
	return s.SaveIncomeData(incomeData)
}
