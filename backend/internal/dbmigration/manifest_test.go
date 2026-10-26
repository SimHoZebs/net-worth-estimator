package dbmigration

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManifestParser(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.json")
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"relative paths", `{"version":1,"sources":[{"path":"data/legacy.db","kind":"sample","resource_id":"plans/sample"}],"sessions_db":"identity.db"}`, true},
		{"unknown top field", `{"version":1,"sources":[],"typo":true}`, false},
		{"unknown source field", `{"version":1,"sources":[{"path":"a.db","owner":"subject"}]}`, false},
		{"trailing object", `{"version":1,"sources":[]} {}`, false},
		{"trailing garbage", `{"version":1,"sources":[]} garbage`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(tc.body), 0600); err != nil {
				t.Fatal(err)
			}
			m, err := ReadManifest(path)
			if !tc.valid {
				if err == nil {
					t.Fatal("accepted invalid manifest")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if m.Sources[0].Path != filepath.Join(dir, "data", "legacy.db") || m.SessionsDB != filepath.Join(dir, "identity.db") {
				t.Fatalf("paths: %+v", m)
			}
		})
	}
}

func TestDestinationRefusals(t *testing.T) {
	source, _ := legacy(t)
	m := Manifest{Version: 1, Sources: []Source{private(source, "alice")}}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		t.Run("existing"+suffix, func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "target.db")
			protected := target + suffix
			if err := os.WriteFile(protected, []byte("must remain unchanged"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(m, target, false); err == nil {
				t.Fatal("accepted occupied destination")
			}
			b, err := os.ReadFile(protected)
			if err != nil || string(b) != "must remain unchanged" {
				t.Fatal("changed existing file")
			}
			if suffix != "" {
				if _, err := os.Lstat(target); !os.IsNotExist(err) {
					t.Fatal("published destination")
				}
			}
		})
	}
}

func TestUnsupportedSourceLeavesTargetAbsent(t *testing.T) {
	source, db := legacy(t)
	if _, err := db.Exec(`CREATE TABLE future_private_data(secret TEXT)`); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "target.db")
	if _, err := Run(Manifest{Version: 1, Sources: []Source{private(source, "alice")}}, target, false); err == nil {
		t.Fatal("accepted unsupported source")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatal("published unsupported source")
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(entries) != 0 {
		t.Fatalf("workspace leaked: %v", entries)
	}
}
