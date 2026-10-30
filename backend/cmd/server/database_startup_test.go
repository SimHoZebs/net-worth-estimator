package main

import (
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerRequiresDeploymentDatabaseWithoutCreatingFiles(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "server")
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build server: %v\n%s", err, output)
	}
	for _, state := range []string{"missing-parent", "missing-file", "empty", "legacy"} {
		t.Run(state, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "application.db")
			if state == "missing-parent" {
				path = filepath.Join(root, "missing", "application.db")
			}
			if state == "empty" {
				if err := os.WriteFile(path, nil, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if state == "legacy" {
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec(`CREATE TABLE legacy_private_data (value TEXT); INSERT INTO legacy_private_data VALUES ('keep')`)
				db.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			var before []byte
			if state == "empty" || state == "legacy" {
				var err error
				before, err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
			}
			command := exec.Command(binary)
			for _, entry := range os.Environ() {
				if !strings.HasPrefix(entry, "NET_WORTH_ESTIMATOR_") {
					command.Env = append(command.Env, entry)
				}
			}
			command.Env = append(command.Env,
				"NET_WORTH_ESTIMATOR_DB="+path,
				"NET_WORTH_ESTIMATOR_AUTH_PROVIDER=casdoor",
				"NET_WORTH_ESTIMATOR_AUTH_ISSUER=http://127.0.0.1:1",
				"NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID=startup-test",
				"NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET=startup-test-secret",
				"NET_WORTH_ESTIMATOR_PUBLIC_URL=http://localhost:18882",
				"NET_WORTH_ESTIMATOR_GUEST_SUBJECT=11111111-1111-1111-1111-111111111111",
			)
			output, err := command.CombinedOutput()
			if err == nil || !strings.Contains(string(output), "open store:") {
				t.Fatalf("server did not fail at database validation: %v\n%s", err, output)
			}
			if state == "empty" || state == "legacy" {
				after, err := os.ReadFile(path)
				if err != nil || string(before) != string(after) {
					t.Fatalf("startup modified existing database: %v", err)
				}
				entries, err := os.ReadDir(root)
				if err != nil || len(entries) != 1 {
					t.Fatalf("startup created database sidecars: %v, %v", entries, err)
				}
			} else if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
				t.Fatalf("startup created a directory or database: %v, %v", entries, err)
			}
		})
	}
}
