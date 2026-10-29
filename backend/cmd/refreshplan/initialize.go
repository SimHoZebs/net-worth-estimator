package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// initialize publishes a new, private dev database only after its selected
// financial scope copies successfully. Production ownership and identity rows
// never enter this file. An existing destination always remains untouched.
func initialize(target, source, sourceAccount, issuer, subject string) error {
	if target == "" || source == "" || issuer == "" || subject == "" {
		return errors.New("initialization requires --db, --source, --init-issuer, and --init-subject")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		if err != nil {
			return err
		}
		return errors.New("initialization requires a new destination database")
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Lstat(target + suffix); !os.IsNotExist(err) {
			return errors.New("initialization destination has an existing SQLite sidecar")
		}
	}
	selected, err := selectSourceAccount(source, sourceAccount)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(target), ".initapp-*.db")
	if err != nil {
		return err
	}
	temporary := f.Name()
	if err := f.Close(); err != nil {
		os.Remove(temporary)
		return err
	}
	defer func() {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			os.Remove(temporary + suffix)
		}
	}()
	db, err := sqlite.SetupDatabase(temporary)
	if err != nil {
		return err
	}
	resource := authorization.ResourceFor(issuer, subject)
	_, err = db.EnsureAccount(authorization.ActorKey(issuer, subject), issuer, subject)
	closeErr := db.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := refresh(temporary, source, selected, resource.ID, false); err != nil {
		return err
	}
	// Same-filesystem hard link publishes atomically without overwriting a
	// database created by another process after the initial existence check.
	return os.Link(temporary, target)
}

func selectSourceAccount(path, selected string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	uri := (&url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro"}).String()
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return "", err
	}
	defer db.Close()
	if selected != "" {
		var present int
		if err := db.QueryRow("SELECT COUNT(*) FROM app_accounts WHERE id=? AND id NOT IN ('sample','fixture')", selected).Scan(&present); err != nil {
			return "", fmt.Errorf("selected source account: %w", err)
		}
		if present != 1 {
			return "", errors.New("setup source must be a private account")
		}
		return selected, nil
	}
	rows, err := db.Query("SELECT id FROM app_accounts WHERE id NOT IN ('sample','fixture') ORDER BY id LIMIT 2")
	if err != nil {
		return "", fmt.Errorf("source must be a current application database: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(ids) != 1 {
		return "", errors.New("source must contain exactly one private account unless --source-account selects its reviewed financial scope")
	}
	return ids[0], nil
}
