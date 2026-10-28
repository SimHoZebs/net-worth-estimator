package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/storetest"
)

// TestStoreConformance runs the shared persistence contract against the
// embedded SQLite backend.
func TestStoreConformance(t *testing.T) {
	storetest.Run(t, openTestStore)
}
