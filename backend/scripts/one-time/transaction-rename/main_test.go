package main

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func seed(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stmts := []string{
		`CREATE TABLE users(id TEXT PRIMARY KEY)`,
		`CREATE TABLE postings(user_id TEXT, id TEXT, name TEXT, source_account_id TEXT, destination_account_ids TEXT, amount_resolution_json TEXT, posted_time INTEGER, transaction_time INTEGER, source TEXT, pending INTEGER, void INTEGER, PRIMARY KEY(user_id,id))`,
		`CREATE TABLE posting_sim(user_id TEXT, posting_id TEXT, position INTEGER, enabled INTEGER, execution_order INTEGER, PRIMARY KEY(user_id,posting_id))`,
		`CREATE TABLE posting_sync_keys(user_id TEXT, provider TEXT, bridge_account_id TEXT, transaction_id TEXT, posting_id TEXT, PRIMARY KEY(user_id,provider,bridge_account_id,transaction_id))`,
		`CREATE TABLE posting_categories(user_id TEXT, posting_id TEXT, category TEXT, source TEXT, producer TEXT, updated_at INTEGER, PRIMARY KEY(user_id,posting_id))`,
		`CREATE TABLE posting_fulfillment_outputs(user_id TEXT, projection_state_id TEXT, kind TEXT, instance_id TEXT, position INTEGER, name TEXT, status TEXT, diagnostics_json TEXT, built_revision INTEGER, has_deterministic INTEGER, has_probabilistic INTEGER, postings_json TEXT, PRIMARY KEY(user_id,projection_state_id,kind,instance_id))`,
		`CREATE TABLE transaction_source_facts(user_id TEXT, posting_id TEXT)`,
		`CREATE TABLE analysis_findings(user_id TEXT, id TEXT, analysis_type TEXT, posting_id TEXT, kind TEXT, PRIMARY KEY(user_id,id))`,
		`CREATE TABLE sharing_grants(owner_user_id TEXT, posting_id TEXT)`,
		`CREATE TABLE suppressed_sync_keys(user_id TEXT, provider TEXT, bridge_account_id TEXT, transaction_id TEXT, suppressed_at INTEGER, PRIMARY KEY(user_id,provider,bridge_account_id,transaction_id))`,
		`CREATE TABLE evaluations(user_id TEXT, type TEXT, instance_id TEXT, position INTEGER, name TEXT, enabled INTEGER, config_json TEXT)`,
		`CREATE TABLE entity_ids(user_id TEXT, id TEXT, kind TEXT)`,
		`CREATE TABLE receipts(user_id TEXT, id TEXT, posting_id TEXT)`,
		`INSERT INTO users VALUES('u1')`,
		`INSERT INTO postings VALUES('u1','t1','Grocer',NULL,'null','{}',1,1,'user',0,0)`,
		`INSERT INTO posting_sim VALUES('u1','t1',0,1,0)`,
		`INSERT INTO posting_sync_keys VALUES('u1','simplefin','bridge','tx1','t1')`,
		`INSERT INTO suppressed_sync_keys VALUES('u1','simplefin','bridge','tx2',1)`,
		`INSERT INTO transaction_source_facts VALUES('u1','t1')`,
		`INSERT INTO sharing_grants VALUES('u1','t1')`,
		`INSERT INTO receipts VALUES('u1','r1','t1')`,
		`INSERT INTO evaluations VALUES('u1','postingFulfillment','e1',0,'Transaction fulfillment',1,'{"postingIds":["t1"],"postingFulfillment":{}}')`,
		`INSERT INTO entity_ids VALUES('u1','t1','posting')`,
		`INSERT INTO posting_fulfillment_outputs VALUES('u1','s1','deterministic','e1',0,'Transaction fulfillment','ok','[]',0,1,1,'[]')`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}

func TestRename(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	seed(t, path)
	migrated, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if !migrated {
		t.Fatal("want migrated")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range []string{"transactions", "transaction_sim", "transaction_sync_keys", "transaction_categories", "transaction_fulfillment_outputs", "transaction_source_facts", "analysis_findings", "sharing_grants", "receipts", "suppressed_sync_keys"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("missing %s: %d %v", table, count, err)
		}
	}
	var kind, etype, cfg, bankTx, txID string
	if err := db.QueryRow(`SELECT kind FROM entity_ids`).Scan(&kind); err != nil || kind != "transaction" {
		t.Fatalf("kind=%s %v", kind, err)
	}
	if err := db.QueryRow(`SELECT type FROM evaluations`).Scan(&etype); err != nil || etype != "transactionFulfillment" {
		t.Fatalf("type=%s %v", etype, err)
	}
	if err := db.QueryRow(`SELECT config_json FROM evaluations`).Scan(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg != `{"transactionIds":["t1"],"transactionFulfillment":{}}` {
		t.Fatalf("cfg=%s", cfg)
	}
	if err := db.QueryRow(`SELECT bank_transaction_id, transaction_id FROM transaction_sync_keys`).Scan(&bankTx, &txID); err != nil {
		t.Fatal(err)
	}
	if bankTx != "tx1" || txID != "t1" {
		t.Fatalf("sync key=%s/%s", bankTx, txID)
	}
	if err := db.QueryRow(`SELECT bank_transaction_id FROM suppressed_sync_keys`).Scan(&bankTx); err != nil || bankTx != "tx2" {
		t.Fatalf("suppressed=%s %v", bankTx, err)
	}
	// Idempotent: second run reports no migration.
	migrated, err = upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if migrated {
		t.Fatal("second run should be no-op")
	}
}
