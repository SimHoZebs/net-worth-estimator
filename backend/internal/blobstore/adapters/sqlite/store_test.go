package sqlite_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/storetest"
	_ "modernc.org/sqlite"
)

func TestBlobStoreContract(t *testing.T) {
	storetest.Run(t, func(t *testing.T) blobstore.Store {
		db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "blobs.db"))
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { db.Close() })
		if _, err := db.Exec(blobsqlite.Schema); err != nil {
			t.Fatal(err)
		}
		return blobsqlite.New(db)
	})
}
