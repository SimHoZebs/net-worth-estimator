package store

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

func TestOpenDatabaseRejectedSourcesStayUnchanged(t *testing.T) {
	for _, tc := range []struct {
		name, ddl string
		want      error
	}{
		{"empty", "", ErrSetupRequired},
		{"legacy", `CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('private')`, ErrLegacyDatabase},
		{"marker-only", `CREATE TABLE schema_migrations(name TEXT PRIMARY KEY); INSERT INTO schema_migrations VALUES ('shared-plans-v1')`, ErrSetupRequired},
		{"missing-identity", `DROP TABLE sessions`, ErrSetupRequired},
		{"missing-financial", `DROP TABLE account_links`, ErrSetupRequired},
		{"missing-column", `ALTER TABLE sessions DROP COLUMN data`, ErrSetupRequired},
		{"missing-index", `DROP INDEX identity_grant_subject`, ErrSetupRequired},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "source.db")
			if tc.name != "empty" && tc.name != "legacy" && tc.name != "marker-only" {
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
			if d, err := OpenDatabase(path); !errors.Is(err, tc.want) {
				if d != nil {
					d.Close()
				}
				t.Fatalf("open = %v, want %v", err, tc.want)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("source changed: %v", err)
			}
			assertFileMode(t, path, 0640)
			for _, suffix := range []string{"-wal", "-shm"} {
				if _, err := os.Lstat(path + suffix); !os.IsNotExist(err) {
					t.Fatalf("rejected open created %s: %v", suffix, err)
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
		if exists, err := d.HasPlan("plans/a"); err != nil || !exists {
			t.Fatalf("plan = %v, %v", exists, err)
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

func TestSetupDatabaseAcceptsEmptyFileAndCompletesSharedSchema(t *testing.T) {
	for _, emptyFile := range []bool{true, false} {
		path := filepath.Join(t.TempDir(), "app.db")
		if emptyFile {
			if err := os.WriteFile(path, nil, 0644); err != nil {
				t.Fatal(err)
			}
		} else {
			d, err := SetupDatabase(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := d.SQL().Exec(`DROP TABLE sessions; DROP INDEX identity_grant_subject`); err != nil {
				t.Fatal(err)
			}
			if err := d.Close(); err != nil {
				t.Fatal(err)
			}
		}
		d, err := SetupDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := checkExistingSchema(d.SQL()); err != nil {
			t.Fatal(err)
		}
		var count int
		if err := d.SQL().QueryRow(`SELECT (SELECT COUNT(*) FROM plans) + (SELECT COUNT(*) FROM app_accounts)`).Scan(&count); err != nil || count != 0 {
			t.Fatalf("setup provisioned accounts/plans: %d, %v", count, err)
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
}

func TestSetupDatabaseRejectsLegacyWithoutChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if d, err := SetupDatabase(path); !errors.Is(err, ErrLegacyDatabase) {
		if d != nil {
			d.Close()
		}
		t.Fatalf("setup legacy = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("legacy source changed: %v", err)
	}
	assertFileMode(t, path, 0644)
}
