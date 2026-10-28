package filesystem_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/filesystem"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/storetest"
)

func TestBlobStoreContract(t *testing.T) {
	storetest.Run(t, func(t *testing.T) blobstore.Store {
		dir := t.TempDir()
		if err := os.Chmod(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		store, err := filesystem.New(dir)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { store.Close() })
		return store
	})
}

func TestFilesystemRequiresPrivateDirectoryAndRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if store, err := filesystem.New(dir); err == nil {
		store.Close()
		t.Fatal("public directory accepted")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	store, err := filesystem.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "object")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(t.Context(), "object"); err == nil {
		t.Fatal("blob followed a symlink")
	}
}
