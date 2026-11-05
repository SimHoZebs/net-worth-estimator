package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func testDB(t *testing.T) (string, string, *sqlite.Database) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "application.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatalf("setup database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.EnsureUser("owner", "https://issuer.test", "owner"); err != nil {
		t.Fatalf("ensure user: %v", err)
	}
	return path, "owner", database
}

func seedLegacyKeys(t *testing.T, database *sqlite.Database, userID string) {
	t.Helper()
	if _, err := database.SQL().Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`INSERT INTO account_links(user_id, bridge_account_id, model_account_id, origin) VALUES (?, 'bridge-checking', 'checking', 'manual')`,
		`INSERT INTO posting_sync_keys(user_id, provider, bridge_account_id, transaction_id, posting_id) VALUES (?, 'simplefin', 'bridge-checking', 'tx1', 'posting-1')`,
		`INSERT INTO suppressed_sync_keys(user_id, provider, bridge_account_id, transaction_id, suppressed_at) VALUES (?, 'simplefin', 'bridge-checking', 'tx2', 1)`,
	}
	for _, statement := range statements {
		if _, err := database.SQL().Exec(statement, userID); err != nil {
			t.Fatalf("seed %q: %v", statement, err)
		}
	}
}

func writeMapping(t *testing.T, userID, connID string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mapping.json")
	body := `{"version":1,"users":{"` + userID + `":{"connections":[{"connId":"` + connID + `","name":"My Bank"}],"accounts":{"bridge-checking":"` + connID + `"}}}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestUpgradeRewritesAllKeyTables(t *testing.T) {
	path, userID, database := testDB(t)
	seedLegacyKeys(t, database, userID)
	mapping := writeMapping(t, userID, "CON-1")

	var out strings.Builder
	if code := run([]string{"--db", path, "--mapping", mapping}, &out, &out); code != 0 {
		t.Fatalf("run = %d: %s", code, out.String())
	}
	key := simplefin.AccountKey("CON-1", "bridge-checking")
	for _, query := range []string{
		`SELECT bridge_account_id FROM account_links WHERE user_id = '` + userID + `'`,
		`SELECT bridge_account_id FROM posting_sync_keys WHERE user_id = '` + userID + `'`,
		`SELECT bridge_account_id FROM suppressed_sync_keys WHERE user_id = '` + userID + `'`,
	} {
		var got string
		if err := database.SQL().QueryRow(query).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != key {
			t.Fatalf("%s = %q, want %q", query, got, key)
		}
	}
	var marker int
	if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, migrationMarker).Scan(&marker); err != nil || marker != 1 {
		t.Fatalf("marker = %d, err %v", marker, err)
	}

	out.Reset()
	if code := run([]string{"--db", path, "--mapping", mapping}, &out, &out); code != 0 {
		t.Fatalf("rerun = %d: %s", code, out.String())
	}
	if !strings.Contains(out.String(), "0 converted") {
		t.Fatalf("rerun output = %q", out.String())
	}
}

func TestDryRunLeavesDatabaseUnchanged(t *testing.T) {
	path, userID, database := testDB(t)
	seedLegacyKeys(t, database, userID)
	mapping := writeMapping(t, userID, "CON-1")
	var out strings.Builder
	if code := run([]string{"--db", path, "--mapping", mapping, "--dry-run"}, &out, &out); code != 0 {
		t.Fatalf("dry run = %d: %s", code, out.String())
	}
	var got string
	if err := database.SQL().QueryRow(`SELECT bridge_account_id FROM account_links WHERE user_id = ?`, userID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "bridge-checking" {
		t.Fatalf("dry run changed key to %q", got)
	}
}

func TestUpgradeAbortsOnAmbiguousStaleKey(t *testing.T) {
	path, userID, database := testDB(t)
	seedLegacyKeys(t, database, userID)
	mappingPath := filepath.Join(t.TempDir(), "mapping.json")
	body := `{"version":1,"users":{"` + userID + `":{"connections":[{"connId":"CON-1"},{"connId":"CON-2"}],"accounts":{}}}}`
	if err := os.WriteFile(mappingPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if code := run([]string{"--db", path, "--mapping", mappingPath}, &out, &out); code == 0 {
		t.Fatalf("ambiguous mapping succeeded: %s", out.String())
	}
	var got string
	if err := database.SQL().QueryRow(`SELECT bridge_account_id FROM account_links WHERE user_id = ?`, userID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "bridge-checking" {
		t.Fatalf("failed conversion changed key to %q", got)
	}
}

func TestBuildMappingReadsV2Bridge(t *testing.T) {
	path, userID, database := testDB(t)
	seedLegacyKeys(t, database, userID)
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("version") != "2" {
			t.Errorf("version = %q", r.URL.Query().Get("version"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"errlist": [],
			"connections": [{"conn_id": "CON-1", "name": "My Bank"}],
			"accounts": [{"id": "checking", "conn_id": "CON-1", "name": "Checking", "currency": "USD", "balance": "10", "balance-date": 10, "transactions": []}]
		}`))
	}))
	t.Cleanup(bridge.Close)
	if _, err := database.SQL().Exec(`UPDATE sync_credentials SET access_url = ? WHERE user_id = ? AND id = 1`, bridge.URL, userID); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "mapping.json")
	var out strings.Builder
	if code := run([]string{"--db", path, "--write-mapping", output}, &out, &out); code != 0 {
		t.Fatalf("write mapping = %d: %s", code, out.String())
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	var decoded mappingFile
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Users[userID].Accounts["checking"] != "CON-1" {
		t.Fatalf("mapping = %+v", decoded)
	}
}
