package store

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

const existingPostingUUID = "01900000-0000-7000-8000-000000000001"

func legacyPostingDatabase(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range schemaStatements() {
		if strings.Contains(statement, "CREATE TABLE IF NOT EXISTS posting_sync_keys") || strings.Contains(statement, "CREATE TABLE IF NOT EXISTS posting_id_migrations") || strings.Contains(statement, "CREATE TABLE IF NOT EXISTS schema_migrations") {
			continue
		}
		statement = strings.Replace(statement, ",\n\t\t\tpending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),\n\t\t\texecution_order INTEGER NOT NULL DEFAULT 0 CHECK (execution_order >= 0)", "", 1)
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range []string{
		`INSERT INTO model_metadata VALUES (1, 'private', 1)`,
		`INSERT INTO accounts (id, position, name, enabled) VALUES ('checking', 0, 'Checking', 1), ('card', 1, 'Card', 1)`,
		`INSERT INTO entity_ids VALUES ('checking', 'account'), ('card', 'account')`,
		`INSERT INTO entity_ids VALUES ('fulfillment', 'evaluation'), ('fi', 'evaluation'), ('sfin-pending-orphan', 'posting')`,
		`INSERT INTO projection_artifacts (identity, kind, payload) VALUES ('old-result', 'deterministic', '{}')`,
		`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json) VALUES ('postingFulfillment', 'fulfillment', 0, 'Payment', 1, '{"postingIds":["old-payment","sync-pending-card-a_b"],"label":"old-payment"}')`,
		`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json) VALUES ('financialIndependence', 'fi', 0, 'FI', 1, '{"continuingPostingIds":["old-payment"],"sources":[{"type":"cashflow","postingId":"old-payment","included":true},{"type":"cashflow","postingId":"sync-pending-card-a_b","included":false},{"type":"cashflow","postingId":"01900000-0000-7000-8000-000000000001","included":true},{"type":"asset","accountId":"card","included":true}],"label":"old-payment"}')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	amount := `{"resolver":"expression","config":{"expression":"payment"},"inputs":{"payment":{"source":"provider","provider":"model-value","arguments":{"id":"old-payment"}},"fee":{"source":"provider","provider":"late-fee","arguments":{"payment":"old-payment","account":"card"}}}}`
	for position, row := range []struct{ id, name, source string }{
		{"old-payment", "Payment", SourceModel},
		{"sync-pending-card-a_b", "Pending bank charge", SourceSimpleFIN},
		{existingPostingUUID, "Existing UUID", SourceModel},
	} {
		if _, err := db.Exec(`INSERT INTO postings (id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, enabled, source) VALUES (?, ?, ?, 'card', 'null', ?, 1785628800, 1785628800, ?, ?)`, row.id, position, row.name, amount, position != 1, row.source); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO entity_ids VALUES (?, 'posting')`, row.id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO purchase_policies VALUES ('old-payment', 3)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO amount_presets (id, position, name, label, amount_json, enabled) VALUES ('preset', 0, 'saved', 'Saved amount', ?, 1)`, amount); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPostingIdentityMigrationIsAtomicAndRepeatable(t *testing.T) {
	path := legacyPostingDatabase(t)
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	document, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Postings) != 3 || len(document.Accounts) != 2 {
		t.Fatal("migration changed financial row counts")
	}
	for _, posting := range document.Postings {
		if _, err := uuid.Parse(posting.ID); err != nil {
			t.Fatal("migration left a non-UUID posting")
		}
		if posting.SourceAccountID == nil || *posting.SourceAccountID != "card" || posting.PostedTime != 1785628800 || posting.TransactionTime != 1785628800 {
			t.Fatal("migration changed financial values")
		}
	}
	payment := document.Postings[0]
	pending := document.Postings[1]
	if payment.ExecutionOrder != 2 || pending.ExecutionOrder != 3 || document.Postings[2].ExecutionOrder != 1 {
		t.Fatal("migration did not preserve the former equal-time execution order separately from display positions")
	}
	if payment.Purchase == nil || payment.Purchase.Priority != 3 || payment.Pending || pending.Enabled || !pending.Pending || pending.Source != SourceSimpleFIN || document.Postings[2].ID != existingPostingUUID {
		t.Fatal("migration changed policy, ownership, pending state, or an existing UUID")
	}
	if payment.Amount.Inputs["payment"].Arguments["id"] != payment.ID || payment.Amount.Inputs["fee"].Arguments["payment"] != payment.ID {
		t.Fatal("posting amount references were not rewritten")
	}
	config := document.Evaluations.PostingFulfillment[0].Config.(map[string]any)
	if !reflect.DeepEqual(config["postingIds"], []any{payment.ID, pending.ID}) || config["label"] != "old-payment" {
		t.Fatal("migration did not distinguish references from presentation strings")
	}
	fi := document.Evaluations.FinancialIndependence[0].Config.(map[string]any)
	wantSources := []any{
		map[string]any{"type": "cashflow", "postingId": payment.ID, "included": true},
		map[string]any{"type": "cashflow", "postingId": pending.ID, "included": false},
		map[string]any{"type": "cashflow", "postingId": existingPostingUUID, "included": true},
		map[string]any{"type": "asset", "accountId": "card", "included": true},
	}
	if !reflect.DeepEqual(fi["continuingPostingIds"], []any{payment.ID}) || !reflect.DeepEqual(fi["sources"], wantSources) || fi["label"] != "old-payment" {
		t.Fatalf("migration changed FI source metadata or left legacy references: %+v", fi)
	}
	presets, err := database.ListAmountPresets()
	if err != nil || presets[0].Amount.Inputs["payment"].Arguments["id"] != payment.ID {
		t.Fatal("preset references were not rewritten")
	}
	raw := database.(*sqliteStore)
	if countRows(t, raw, "posting_id_migrations", "") != 2 || countRows(t, raw, "entity_ids", "kind = 'posting'") != 3 || countRows(t, raw, "projection_artifacts", "") != 0 {
		t.Fatal("migration left an invalid registry, alias map, or stale artifact")
	}
	foreignKeys, err := raw.db.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	if foreignKeys.Next() {
		foreignKeys.Close()
		t.Fatal("migration left an invalid foreign key")
	}
	if err := foreignKeys.Err(); err != nil {
		foreignKeys.Close()
		t.Fatal(err)
	}
	foreignKeys.Close()
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	again, err := database.LoadDocument()
	if err != nil || !reflect.DeepEqual(document, again) {
		t.Fatal("reopening migrated data changed IDs or financial data")
	}
}

func TestPostingIdentityMigrationRollsBackOnInvalidReferences(t *testing.T) {
	path := legacyPostingDatabase(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`UPDATE amount_presets SET amount_json = 'invalid JSON'`); err != nil {
		t.Fatal(err)
	}
	if database, err := Open(path); err == nil {
		database.Close()
		t.Fatal("migration accepted invalid stored metadata")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM postings WHERE id IN ('old-payment', 'sync-pending-card-a_b')`).Scan(&count); err != nil || count != 2 {
		t.Fatal("failed migration changed posting identities")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM purchase_policies WHERE posting_id = 'old-payment'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("failed migration changed purchase policies")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'schema_migrations'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration recorded partial schema changes")
	}
}

func TestPostingIdentityMigrationRecognizesLegacyPendingMetadata(t *testing.T) {
	path := legacyPostingDatabase(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`UPDATE postings SET id = 'sfin-pending-card-old' WHERE id = 'sync-pending-card-a_b'`,
		`UPDATE entity_ids SET id = 'sfin-pending-card-old' WHERE id = 'sync-pending-card-a_b'`,
		`UPDATE evaluations SET config_json = replace(config_json, 'sync-pending-card-a_b', 'sfin-pending-card-old')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			t.Fatal(err)
		}
	}
	db.Close()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	document, err := database.LoadDocument()
	if err != nil || !document.Postings[1].Pending || document.Postings[1].Enabled {
		t.Fatal("legacy bank pending metadata was not preserved")
	}
	if _, err := uuid.Parse(document.Postings[1].ID); err != nil {
		t.Fatal("legacy pending identity is not a UUID")
	}
}
