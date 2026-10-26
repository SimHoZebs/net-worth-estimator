package dbmigration

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// This frozen legacy schema must not use store.Open: that constructor deliberately
// rejects legacy files after the shared database transition.
const legacySchema = `
CREATE TABLE accounts(id TEXT PRIMARY KEY,position INTEGER NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,min_balance REAL,max_balance REAL,color TEXT,enabled INTEGER NOT NULL);
CREATE TABLE checkpoints(id INTEGER PRIMARY KEY,position INTEGER NOT NULL,date TEXT NOT NULL,account_id TEXT NOT NULL,balance REAL NOT NULL,source TEXT NOT NULL,UNIQUE(account_id,date));
CREATE TABLE postings(id TEXT PRIMARY KEY,position INTEGER NOT NULL,name TEXT NOT NULL,source_account_id TEXT,destinations TEXT,amount_resolution_json TEXT NOT NULL,posted_time INTEGER NOT NULL,transaction_time INTEGER NOT NULL,fulfills_rule_id TEXT,fulfills_occurrence_date TEXT,enabled INTEGER NOT NULL,source TEXT NOT NULL,pending INTEGER NOT NULL,execution_order INTEGER NOT NULL);
CREATE TABLE posting_sync_keys(provider TEXT NOT NULL,account_id TEXT NOT NULL,transaction_id TEXT NOT NULL,posting_id TEXT NOT NULL UNIQUE,PRIMARY KEY(provider,account_id,transaction_id));
CREATE TABLE posting_id_migrations(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL UNIQUE);
CREATE TABLE schema_migrations(name TEXT PRIMARY KEY);
CREATE TABLE purchase_policies(posting_id TEXT PRIMARY KEY,priority INTEGER NOT NULL);
CREATE TABLE recurrence_rules(id TEXT PRIMARY KEY,position INTEGER NOT NULL,name TEXT NOT NULL,source_account_id TEXT,destinations TEXT,amount_resolution_json TEXT NOT NULL,frequency TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT,annual_cap REAL,priority INTEGER NOT NULL,enabled INTEGER NOT NULL);
CREATE TABLE evaluations(type TEXT NOT NULL,instance_id TEXT NOT NULL,position INTEGER NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL,config_json TEXT NOT NULL,PRIMARY KEY(type,instance_id));
CREATE TABLE projection_artifacts(identity TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE model_metadata(id INTEGER PRIMARY KEY,source_path TEXT NOT NULL,document_present INTEGER NOT NULL);
CREATE TABLE payment_terms(account_id TEXT PRIMARY KEY,position INTEGER NOT NULL,minimum_fixed REAL NOT NULL,minimum_percent REAL,due_day INTEGER NOT NULL,statement_day INTEGER);
CREATE TABLE entity_ids(id TEXT PRIMARY KEY,kind TEXT NOT NULL);
CREATE TABLE account_links(bridge_account_id TEXT PRIMARY KEY,model_account_id TEXT NOT NULL UNIQUE,bridge_name TEXT NOT NULL,currency TEXT NOT NULL,origin TEXT NOT NULL,last_seen_at TEXT NOT NULL);
CREATE TABLE pinned_evaluations(instance_id TEXT PRIMARY KEY,position INTEGER NOT NULL);
CREATE TABLE safe_spending_settings(id INTEGER PRIMARY KEY,settings_json TEXT NOT NULL);
CREATE TABLE sync_state(id INTEGER PRIMARY KEY,last_sync_at TEXT NOT NULL);
CREATE TABLE amount_presets(id TEXT PRIMARY KEY,position INTEGER NOT NULL,name TEXT NOT NULL UNIQUE,label TEXT NOT NULL,summary TEXT NOT NULL,when_use TEXT NOT NULL,amount_json TEXT NOT NULL,enabled INTEGER NOT NULL);
INSERT INTO model_metadata VALUES(1,'legacy',1);
INSERT INTO sync_state VALUES(1,'2026-01-01T00:00:00Z');
INSERT INTO schema_migrations VALUES('posting-uuid-and-pending-v1');
INSERT INTO accounts VALUES('same-id',7,'Checking','cash',NULL,NULL,NULL,1);
INSERT INTO entity_ids VALUES('same-id','account');
INSERT INTO amount_presets VALUES('preset',3,'fixed','Fixed','','','{}',1);
INSERT INTO safe_spending_settings VALUES(1,'{"buffer":123}');
INSERT INTO postings VALUES('019ad291-1234-7000-8000-000000000001',9,'Purchase','same-id',NULL,'{}',100,100,NULL,NULL,1,'simplefin',1,42);
INSERT INTO posting_sync_keys VALUES('simplefin','same-id','transaction-id','019ad291-1234-7000-8000-000000000001');
INSERT INTO purchase_policies VALUES('019ad291-1234-7000-8000-000000000001',2);
INSERT INTO checkpoints VALUES(23,4,'2026-01-01','same-id',123,'model');
`

func legacy(t *testing.T) (string, *sql.DB) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", p+"?_pragma=journal_mode(WAL)&_pragma=wal_autocheckpoint(0)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatal(err)
	}
	return p, db
}

func private(path, subject string) Source {
	return Source{Path: path, Kind: "private", Issuer: "https://issuer.example", Subject: subject, ResourceID: authorization.ResourceFor("https://issuer.example", subject).ID}
}

func TestTwoSourcesAndWAL(t *testing.T) {
	a, adb := legacy(t)
	b, _ := legacy(t)
	// Keep the writer open. This row exists only in its committed WAL.
	if _, err := adb.Exec(`UPDATE accounts SET name='WAL value'`); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(a + "-wal"); err != nil || info.Size() == 0 {
		t.Fatal("fixture has no WAL")
	}
	sources := []Source{private(a, "alice"), private(b, "bob")}
	target := filepath.Join(t.TempDir(), "shared.db")
	r, err := Run(Manifest{Version: 1, Sources: sources}, target, false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Plans != 2 {
		t.Fatalf("report: %+v", r)
	}
	db, err := store.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for i, s := range sources {
		var name string
		var position int
		if err := db.SQL().QueryRow(`SELECT name,position FROM accounts WHERE plan_id=? AND id='same-id'`, s.ResourceID).Scan(&name, &position); err != nil {
			t.Fatal(err)
		}
		want := "Checking"
		if i == 0 {
			want = "WAL value"
		}
		if name != want || position != 7 {
			t.Fatalf("lost payload: %q %d", name, position)
		}
		var executionOrder int
		if err := db.SQL().QueryRow(`SELECT execution_order FROM postings WHERE plan_id=? AND id='019ad291-1234-7000-8000-000000000001'`, s.ResourceID).Scan(&executionOrder); err != nil || executionOrder != 42 {
			t.Fatalf("posting order changed: %d %v", executionOrder, err)
		}
		var postingID string
		if err := db.SQL().QueryRow(`SELECT posting_id FROM posting_sync_keys WHERE plan_id=? AND transaction_id='transaction-id'`, s.ResourceID).Scan(&postingID); err != nil || postingID != "019ad291-1234-7000-8000-000000000001" {
			t.Fatalf("sync key changed: %q %v", postingID, err)
		}
		var checkpointID int
		if err := db.SQL().QueryRow(`SELECT id FROM checkpoints WHERE plan_id=?`, s.ResourceID).Scan(&checkpointID); err != nil || checkpointID != 23 {
			t.Fatalf("checkpoint ID changed: %d %v", checkpointID, err)
		}
	}
	var original string
	if err := adb.QueryRow(`SELECT name FROM accounts`).Scan(&original); err != nil || original != "WAL value" {
		t.Fatal("source changed")
	}
}

func TestRejectedManifestAndAliases(t *testing.T) {
	a, _ := legacy(t)
	b, _ := legacy(t)
	alias := filepath.Join(t.TempDir(), "alias.db")
	if err := os.Symlink(a, alias); err != nil {
		t.Fatal(err)
	}
	badOwner := private(a, "alice")
	badOwner.Subject = ""
	badID := private(a, "alice")
	badID.ResourceID = private(a, "bob").ResourceID
	for _, sources := range [][]Source{{badOwner}, {badID}, {private(a, "alice"), private(b, "alice")}, {private(a, "alice"), private(alias, "bob")}} {
		target := filepath.Join(t.TempDir(), "target.db")
		if _, err := Run(Manifest{Version: 1, Sources: sources}, target, false); err == nil {
			t.Fatal("accepted invalid manifest")
		}
		if _, err := os.Lstat(target); !os.IsNotExist(err) {
			t.Fatal("published failed destination")
		}
	}
}

func TestRollbackAndDryRun(t *testing.T) {
	a, _ := legacy(t)
	b, bdb := legacy(t)
	if _, err := bdb.Exec(`ALTER TABLE postings DROP COLUMN execution_order`); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "target.db")
	_, err := Run(Manifest{Version: 1, Sources: []Source{private(a, "alice"), private(b, "bob")}}, target, false)
	if err == nil || !strings.Contains(err.Error(), "unsupported schema") {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatal("published partial destination")
	}
	if _, err := Run(Manifest{Version: 1, Sources: []Source{private(a, "alice")}}, target, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatal("dry run published target")
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(entries) != 0 {
		t.Fatalf("workspace leaked: %v", entries)
	}
}

func TestIdentityTokensAndLogout(t *testing.T) {
	a, _ := legacy(t)
	p := filepath.Join(t.TempDir(), "sessions.db")
	id, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer id.Close()
	_, err = id.Exec(`CREATE TABLE sessions(token TEXT PRIMARY KEY,data BLOB NOT NULL,expiry INTEGER NOT NULL);
CREATE TABLE identity_grants(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,sid TEXT NOT NULL,expiry INTEGER NOT NULL,data BLOB NOT NULL);
CREATE TABLE identity_logout_marks(issuer TEXT NOT NULL,kind TEXT NOT NULL,identifier TEXT NOT NULL,seen_at INTEGER NOT NULL,expiry INTEGER NOT NULL,PRIMARY KEY(issuer,kind,identifier));
CREATE TABLE identity_logout_tokens(issuer TEXT NOT NULL,jti TEXT NOT NULL,expiry INTEGER NOT NULL,PRIMARY KEY(issuer,jti));
INSERT INTO sessions VALUES('opaque-token',X'000102FF',999);
INSERT INTO identity_grants VALUES('grant-id','issuer','subject','sid',999,X'0100');
INSERT INTO identity_logout_marks VALUES('issuer','sid','sid',123,999);
INSERT INTO identity_logout_tokens VALUES('issuer','jti',999);`)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "target.db")
	r, err := Run(Manifest{Version: 1, Sources: []Source{private(a, "alice")}, SessionsDB: p}, target, false)
	if err != nil {
		t.Fatal(err)
	}
	if r.IdentityRows != 4 {
		t.Fatalf("report: %+v", r)
	}
	db, err := store.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var data []byte
	if err := db.SQL().QueryRow(`SELECT data FROM sessions WHERE token='opaque-token'`).Scan(&data); err != nil {
		t.Fatal(err)
	}
	if string(data) != string([]byte{0, 1, 2, 255}) {
		t.Fatal("opaque session changed")
	}
}
