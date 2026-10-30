// Package apitest supplies disposable data and wire fixtures for API tests.
// It does not import the API composition root or any HTTP feature package.
package apitest

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func OpenStore(t *testing.T) store.Store {
	t.Helper()
	database, err := sqlite.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("open API store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func ProjectRoot(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(directory, "backend", "go.mod")); err == nil {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatal("project root not found")
		}
		directory = parent
	}
}
