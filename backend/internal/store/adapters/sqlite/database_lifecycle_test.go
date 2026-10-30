package sqlite

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestOpenDatabaseMissingNeverCreates(t *testing.T) {
	for _, name := range []string{"missing.db", "missing/parent/app.db"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, name)
			if d, err := OpenDatabase(path); !errors.Is(err, ErrSetupRequired) {
				if d != nil {
					d.Close()
				}
				t.Fatalf("open missing = %v", err)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("open created files: %v, %v", entries, err)
			}
		})
	}
}

func TestDatabaseRejectedSourcesStayUnchanged(t *testing.T) {
	for _, tc := range []struct {
		name, ddl string
		want      error
	}{
		{"empty", "", ErrSetupRequired},
		{"marker-accounts-only", `CREATE TABLE schema_migrations(name TEXT PRIMARY KEY); INSERT INTO schema_migrations VALUES ('shared-accounts-v1')`, ErrSetupRequired},
		{"missing-identity", `DROP TABLE sessions`, ErrSetupRequired},
		{"missing-groups", `DROP TABLE group_members`, ErrSetupRequired},
		{"missing-financial", `DROP TABLE account_links`, ErrSetupRequired},
		{"missing-purchases", `DROP TABLE planned_purchases`, ErrSetupRequired},
		{"missing-column", `ALTER TABLE sessions DROP COLUMN data`, ErrSetupRequired},
		{"missing-receipt-field", `ALTER TABLE postings DROP COLUMN receipt_ids`, ErrSetupRequired},
		{"missing-void-field", `DROP TRIGGER analysis_posting_lifecycle; ALTER TABLE postings DROP COLUMN void`, ErrSetupRequired},
		{"missing-index", `DROP INDEX identity_grant_subject`, ErrSetupRequired},
		{"missing-blob-index", `DROP INDEX blob_cleanup`, ErrSetupRequired},
		{"missing-receipt-index", `DROP INDEX receipt_blob_key`, ErrSetupRequired},
		{"missing-blob-trigger", `DROP TRIGGER receipt_blob_delete`, ErrSetupRequired},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "source.db")
			if tc.name != "empty" && tc.name != "marker-accounts-only" {
				d, err := SetupDatabase(path)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := d.SQL().Exec(tc.ddl); err != nil {
					t.Fatal(err)
				}
				if err := d.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.WriteFile(path, nil, 0600); err != nil {
					t.Fatal(err)
				}
				if tc.ddl != "" {
					db, err := sql.Open("sqlite", path)
					if err != nil {
						t.Fatal(err)
					}
					if _, err := db.Exec(tc.ddl); err != nil {
						t.Fatal(err)
					}
					if err := db.Close(); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := os.Chmod(path, 0640); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, open := range []struct {
				name string
				call func(string, ...DatabaseOption) (*Database, error)
			}{{"runtime", OpenDatabase}, {"setup", SetupDatabase}} {
				if tc.name == "empty" && open.name == "setup" {
					continue
				}
				if d, err := open.call(path); !errors.Is(err, tc.want) {
					if d != nil {
						d.Close()
					}
					t.Fatalf("%s = %v, want %v", open.name, err, tc.want)
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("%s changed source: %v", open.name, err)
				}
				assertFileMode(t, path, 0640)
				for _, suffix := range []string{"-wal", "-shm"} {
					if _, err := os.Lstat(path + suffix); !os.IsNotExist(err) {
						t.Fatalf("rejected %s created %s: %v", open.name, suffix, err)
					}
				}
			}
		})
	}
}

func TestSetupDatabaseAndRepeatedOpenPreserveSchemaAndData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "new", "app.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	privateTestPlan(t, d, "a")
	if _, err := d.SQL().Exec(`INSERT INTO sessions VALUES ('session', X'0102', 123)`); err != nil {
		t.Fatal(err)
	}
	schema := databaseSchemaSnapshot(t, d)
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := os.Chmod(path, 0664); err != nil {
			t.Fatal(err)
		}
		d, err = OpenDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		assertFileMode(t, path, 0664)
		if got := databaseSchemaSnapshot(t, d); !reflect.DeepEqual(got, schema) {
			t.Fatal("runtime changed schema")
		}
		var token string
		if err := d.SQL().QueryRow(`SELECT token FROM sessions`).Scan(&token); err != nil || token != "session" {
			t.Fatalf("session = %q, %v", token, err)
		}
		if exists, err := d.HasUser("a"); err != nil || !exists {
			t.Fatalf("user = %v, %v", exists, err)
		}
		if err := d.Close(); err != nil {
			t.Fatal(err)
		}
	}
	d, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	assertFileMode(t, path, 0600)
	if got := databaseSchemaSnapshot(t, d); !reflect.DeepEqual(got, schema) {
		t.Fatal("idempotent setup changed schema")
	}
}

func databaseSchemaSnapshot(t *testing.T, d *Database) []string {
	t.Helper()
	rows, err := d.SQL().Query(`SELECT type || ':' || name || ':' || COALESCE(sql, '') FROM sqlite_master ORDER BY type, name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			t.Fatal(err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestSetupDatabaseAcceptsEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	if err := os.WriteFile(path, nil, 0644); err != nil {
		t.Fatal(err)
	}
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkExistingSchema(d.SQL()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("setup provisioned users: %d, %v", count, err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d, err = OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	d.Close()
}
