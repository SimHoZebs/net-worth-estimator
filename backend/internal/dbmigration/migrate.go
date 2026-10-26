package dbmigration

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Report contains counts only. It never exposes identities, paths or tokens.
type Report struct {
	Plans         int  `json:"plans"`
	FinancialRows int  `json:"financial_rows"`
	IdentityRows  int  `json:"identity_rows"`
	DryRun        bool `json:"dry_run"`
}

// Run builds a private temporary database on the destination filesystem. A
// no-replace hard link publishes its closed, checkpointed file atomically.
// DryRun executes the same copy and verification, but never publishes a file.
// Operators must stop all services before calling this offline migration.
func Run(m Manifest, destination string, dryRun bool) (Report, error) {
	r := Report{DryRun: dryRun}
	if destination == "" {
		return r, fmt.Errorf("explicit destination database path is required")
	}
	if err := m.validate(); err != nil {
		return r, err
	}
	if _, err := os.Lstat(destination); err == nil {
		return r, fmt.Errorf("destination must be a new, absent path")
	} else if !os.IsNotExist(err) {
		return r, fmt.Errorf("inspect destination: %w", err)
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Lstat(destination + suffix); err == nil || !os.IsNotExist(err) {
			return r, fmt.Errorf("destination has an existing SQLite sidecar")
		}
	}
	work, err := os.MkdirTemp(filepath.Dir(destination), ".migratedb-")
	if err != nil {
		return r, fmt.Errorf("create private migration workspace: %w", err)
	}
	defer os.RemoveAll(work)
	path := filepath.Join(work, "database.sqlite")
	db, err := store.SetupDatabase(path)
	if err != nil {
		return r, fmt.Errorf("create shared database: %w", err)
	}
	defer db.Close()
	for i, s := range m.Sources {
		src, err := openSnapshot(s.Path)
		if err != nil {
			return r, fmt.Errorf("source %d: %w", i+1, err)
		}
		err = migratePlan(db, src, s, &r)
		src.close()
		if err != nil {
			return r, fmt.Errorf("source %d: %w", i+1, err)
		}
		r.Plans++
	}
	if m.SessionsDB != "" {
		src, err := openSnapshot(m.SessionsDB)
		if err != nil {
			return r, fmt.Errorf("identity source: %w", err)
		}
		err = migrateIdentity(db, src, &r)
		src.close()
		if err != nil {
			return r, err
		}
	}
	var check string
	if err := db.SQL().QueryRow("PRAGMA integrity_check").Scan(&check); err != nil || check != "ok" {
		return r, fmt.Errorf("target integrity check failed")
	}
	rows, err := db.SQL().Query("PRAGMA foreign_key_check")
	if err != nil {
		return r, fmt.Errorf("target foreign-key check failed")
	}
	invalid := rows.Next()
	err = rows.Err()
	rows.Close()
	if invalid || err != nil {
		return r, fmt.Errorf("target contains invalid foreign keys")
	}
	var busy, logFrames, checkpointed int
	if err := db.SQL().QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &checkpointed); err != nil || busy != 0 {
		return r, fmt.Errorf("target checkpoint failed")
	}
	if err := db.Close(); err != nil {
		return r, fmt.Errorf("close target")
	}
	if dryRun {
		return r, nil
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0600)
	if err != nil {
		return r, fmt.Errorf("open verified target")
	}
	err = f.Chmod(0600)
	if err == nil {
		err = f.Sync()
	}
	f.Close()
	if err != nil {
		return r, fmt.Errorf("sync verified target")
	}
	if err := os.Link(path, destination); err != nil {
		return r, fmt.Errorf("publish target without overwrite: %w", err)
	}
	return r, nil
}

func migratePlan(db *store.Database, src *snapshot, s Source, r *Report) error {
	if err := validateTables(src, financialTables); err != nil {
		return err
	}
	for table := range singletonTables {
		var invalid int
		if err := src.tx.QueryRow("SELECT COUNT(*) FROM " + quote(table) + " WHERE id<>1").Scan(&invalid); err != nil || invalid != 0 {
			return fmt.Errorf("unsupported singleton schema for %s", table)
		}
	}
	var err error
	if s.Kind == "sample" {
		_, err = db.EnsureSamplePlan()
	} else {
		_, err = db.EnsurePrivatePlan(s.ResourceID, authorization.ActorKey(s.Issuer, s.Subject), s.Issuer, s.Subject)
	}
	if err != nil {
		return fmt.Errorf("create plan ownership: %w", err)
	}
	tx, err := db.SQL().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Deferred checks allow a faithful copy regardless of table dependency order.
	if _, err := tx.Exec("PRAGMA defer_foreign_keys=ON"); err != nil {
		return err
	}
	for _, table := range financialTables {
		n, err := copyTable(src.tx, tx, table, s.ResourceID)
		if err != nil {
			return err
		}
		r.FinancialRows += n
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit plan: constraint conflict")
	}
	return nil
}

func validateTables(src *snapshot, allowed []string) error {
	known := map[string]bool{}
	for _, t := range allowed {
		known[t] = true
	}
	rows, err := src.tx.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		return fmt.Errorf("inspect source tables")
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return fmt.Errorf("inspect source table")
		}
		if !known[name] {
			return fmt.Errorf("unsupported source schema: unrecognized table; use a compatible previous release backup")
		}
	}
	return rows.Err()
}
