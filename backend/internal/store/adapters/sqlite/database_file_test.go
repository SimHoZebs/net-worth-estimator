package sqlite

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func assertFileMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode = %04o, want %04o", path, got, want)
	}
}

func TestSetupDatabaseFilesArePrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.EnsureUser(authorization.ActorKey("https://issuer.test", "ordinarytest"), "https://issuer.test", "ordinarytest"); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		assertFileMode(t, path+suffix, 0600)
	}
}

func TestSetupDatabaseTightensBroadExistingPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0664); err != nil {
		t.Fatal(err)
	}
	d, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	assertFileMode(t, path, 0600)
}

func TestSetupDatabaseDoesNotRelaxTighterPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0400); err != nil {
		t.Fatal(err)
	}
	// An operator's read-only mode may prevent opening for writes. Either
	// outcome must leave that tighter mode intact.
	d, _ = SetupDatabase(path)
	if d != nil {
		d.Close()
	}
	assertFileMode(t, path, 0400)
}

func TestSharedDatabaseRejectsSymlinkPaths(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.db")
	d, err := SetupDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	d.Close()
	if err := os.Chmod(target, 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.db")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	for _, open := range []func(string, ...DatabaseOption) (*Database, error){OpenDatabase, SetupDatabase} {
		if d, err := open(link); err == nil {
			d.Close()
			t.Fatal("followed database symlink")
		}
	}
	assertFileMode(t, target, 0644)
	realDir := filepath.Join(root, "real")
	if err := os.Mkdir(realDir, 0700); err != nil {
		t.Fatal(err)
	}
	linkedDir := filepath.Join(root, "linked")
	if err := os.Symlink(realDir, linkedDir); err != nil {
		t.Fatal(err)
	}
	for _, open := range []func(string, ...DatabaseOption) (*Database, error){OpenDatabase, SetupDatabase} {
		if d, err := open(filepath.Join(linkedDir, "new.db")); err == nil {
			d.Close()
			t.Fatal("followed parent directory symlink")
		}
	}
	if _, err := os.Stat(filepath.Join(realDir, "new.db")); !os.IsNotExist(err) {
		t.Fatalf("unsafe parent created database: %v", err)
	}
}

func TestSharedDatabaseRejectsSidecarSymlink(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "shared.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	d.Close()
	target := filepath.Join(root, "other-file")
	if err := os.WriteFile(target, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path+"-wal"); err != nil {
		t.Fatal(err)
	}
	for _, open := range []func(string, ...DatabaseOption) (*Database, error){OpenDatabase, SetupDatabase} {
		if d, err := open(path); err == nil {
			d.Close()
			t.Fatal("followed sidecar symlink")
		}
	}
	assertFileMode(t, target, 0644)
}
