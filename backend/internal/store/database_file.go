package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"syscall"
)

// existingDatabaseFile checks paths and schemas without creating files or
// changing permissions. Setup accepts empty files and the current schema marker.
func existingDatabaseFile(path string, setup bool) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if err := rejectSymlinkParents(filepath.Dir(abs)); err != nil {
		return "", fmt.Errorf("%w: database parent: %v", ErrSetupRequired, err)
	}
	if info, err := os.Lstat(abs); err == nil {
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("database path must be a regular file")
		}
	} else if err != nil {
		return "", fmt.Errorf("%w: database file: %v", ErrSetupRequired, err)
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		info, err := os.Lstat(abs + suffix)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("database sidecar must be a regular file")
		}
	}
	f, err := os.OpenFile(abs, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return "", fmt.Errorf("open private database file: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("database path must be a regular file")
	}
	u := &url.URL{Scheme: "file", Path: abs}
	validationDSN := u.String() + "?mode=ro"
	// Without a WAL, immutable reads prevent SQLite from creating sidecars
	// merely to inspect a rejected WAL-mode database. A live WAL must remain
	// visible so validation sees the same committed schema as the runtime.
	if wal, err := os.Stat(abs + "-wal"); os.IsNotExist(err) || (err == nil && wal.Size() == 0) {
		validationDSN += "&immutable=1"
	}
	db, err := sql.Open("sqlite", validationDSN)
	if err != nil {
		return "", err
	}
	if setup {
		var count int
		err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).Scan(&count)
		if err == nil && count != 0 {
			err = checkSharedSchemaMarker(db)
		}
	} else {
		err = checkExistingSchema(db)
	}
	db.Close()
	if err != nil {
		return "", err
	}
	current, err := os.Lstat(abs)
	if err != nil {
		return "", err
	}
	if current.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, current) {
		return "", fmt.Errorf("database path changed during open")
	}
	return u.String(), nil
}

// setupDatabaseFile alone creates private files and tightens broad permissions.
// Existing schemas are checked before any permission change.
func setupDatabaseFile(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	// Check existing ancestors before MkdirAll can follow a directory symlink.
	parent := filepath.Dir(abs)
	for {
		if _, err := os.Lstat(parent); err == nil {
			if err := rejectSymlinkParents(parent); err != nil {
				return "", err
			}
			break
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent = filepath.Dir(parent)
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
		return "", err
	}
	f, err := os.OpenFile(abs, os.O_RDWR|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err == nil {
		if err := f.Close(); err != nil {
			return "", err
		}
	} else if !os.IsExist(err) {
		return "", err
	}
	dsn, err := existingDatabaseFile(abs, true)
	if err != nil {
		return "", err
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := protectDatabaseSidecar(abs + suffix); err != nil {
			return "", err
		}
	}
	return dsn, nil
}

func rejectSymlinkParents(path string) error {
	for {
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("database parent must be a real directory: %s", path)
		}
		parent := filepath.Dir(path)
		if parent == path {
			return nil
		}
		path = parent
	}
}

func protectDatabaseSidecar(path string) error {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open database sidecar: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("database sidecar must be a regular file")
	}
	return f.Chmod(info.Mode().Perm() & 0600)
}

func checkExistingSchema(db queryer) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return ErrSetupRequired
	}
	if err := checkSharedSchemaMarker(db); err != nil {
		return err
	}
	return validateSchemaObjects(db)
}

func checkSharedSchemaMarker(db queryer) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return ErrLegacyDatabase
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, sharedSchemaVersion).Scan(&count); err != nil {
		return fmt.Errorf("%w: invalid schema marker: %v", ErrLegacyDatabase, err)
	}
	if count != 1 {
		return ErrLegacyDatabase
	}
	return nil
}
