package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestLegacyDatabaseRequiresOfflineMigration(t *testing.T) {
	for _, current := range []bool{false, true} {
		t.Run(map[bool]string{false: "older-postings", true: "current-postings"}[current], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "legacy.db")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			ddl := `CREATE TABLE postings(id TEXT PRIMARY KEY, name TEXT NOT NULL`
			if current {
				ddl += `, pending INTEGER NOT NULL DEFAULT 0, execution_order INTEGER NOT NULL DEFAULT 0`
			}
			if _, err := db.Exec(ddl + `)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO postings(id, name) VALUES ('old-payment', 'Payment')`); err != nil {
				t.Fatal(err)
			}
			if current {
				if _, err := db.Exec(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY); INSERT INTO schema_migrations VALUES ('posting-uuid-and-pending-v1')`); err != nil {
					t.Fatal(err)
				}
			}
			for _, open := range []func(string) error{
				func(p string) error {
					d, err := OpenDatabase(p)
					if d != nil {
						d.Close()
					}
					return err
				},
				func(p string) error {
					s, err := Open(p)
					if s != nil {
						s.Close()
					}
					return err
				},
			} {
				if err := open(path); !errors.Is(err, ErrMigrationRequired) {
					t.Fatalf("open = %v", err)
				}
			}
			var id string
			if err := db.QueryRow(`SELECT id FROM postings`).Scan(&id); err != nil || id != "old-payment" {
				t.Fatalf("source changed: %q, %v", id, err)
			}
			var count int
			if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('plans', 'app_accounts')`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("partial shared schema: %d, %v", count, err)
			}
		})
	}
}
