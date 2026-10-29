// Package testseed seeds a Store from CSV fixtures for tests.
// Production code uses ImportDocument with an already-loaded document;
// only tests and sqlite-specific ops tools read CSV files.
package testseed

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func Seed(s store.Store, path string) (*types.FinancialModelDocument, error) {
	doc, err := csvio.ImportModel(path)
	if err != nil {
		return nil, err
	}
	return s.ImportDocument(doc)
}
