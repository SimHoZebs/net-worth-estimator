package memory

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/storetest"
)

func TestStoreConformance(t *testing.T) {
	storetest.Run(t, func(*testing.T) blobstore.Store { return New() })
}
