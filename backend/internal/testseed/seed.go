// Package testseed seeds a Store from CSV fixtures for tests.
// Production code uses ImportModel with an already-loaded model;
// only tests and sqlite-specific ops tools read CSV files.
package testseed

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func Seed(s store.Store, path string) (*types.FinancialModel, error) {
	doc, err := csvio.ImportModel(path)
	if err != nil {
		return nil, err
	}
	return s.ImportModel(doc)
}
