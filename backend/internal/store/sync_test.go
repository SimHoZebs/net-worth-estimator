package store

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const syncTestAmountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`

func withSourceModel(checkpoints []types.Checkpoint) []types.Checkpoint {
	out := make([]types.Checkpoint, len(checkpoints))
	for i, checkpoint := range checkpoints {
		checkpoint.Source = SourceModel
		out[i] = checkpoint
	}
	return out
}

func execSyncSetup(t *testing.T, store *Store, statements []string) {
	t.Helper()
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatalf("begin sync setup: %v", err)
	}
	defer tx.Rollback()
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("sync setup %q: %v", statement, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit sync setup: %v", err)
	}
}

func seedSyncRows(t *testing.T, store *Store) {
	t.Helper()
	execSyncSetup(t, store, []string{
		`INSERT INTO accounts (id, position, label, enabled) VALUES ('prime_card', 1, 'Prime', 1)`,
		`INSERT INTO checkpoints (position, date, account_id, balance, source) VALUES (10, '2026-08-01', 'checking', 111, 'simplefin')`,
		`INSERT INTO postings (id, position, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, priority, enabled, source)
		 VALUES ('sfin-pending-prime_card-tx1', 10, 'Pending charge', 'prime_card', 'null', '` + syncTestAmountJSON + `', 'once', 0, 0, 0, '2026-08-02', 6, 0, 'simplefin')`,
	})
}

func ownerDocument() *types.FinancialModelDocument {
	checking := "checking"
	return &types.FinancialModelDocument{
		SourcePath: "test-source",
		Accounts: []types.Account{{
			ID: "checking", Label: "Checking", Enabled: true,
		}},
		Checkpoints: []types.Checkpoint{
			{Date: "2026-07-01", AccountID: "checking", Balance: 500},
		},
		Evaluations: types.EmptyEvaluationTables(),
		Postings: []types.Posting{{
			ID: "owner-charge", Label: "Owner", SourceAccountID: &checking,
			Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			Frequency: types.FrequencyOnce, StartDate: "2026-07-02", Priority: 6,
		}},
	}
}

func loadPostingIDs(t *testing.T, store *Store) (ids []string, sources map[string]string) {
	t.Helper()
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	sources = map[string]string{}
	for _, posting := range loaded.Postings {
		ids = append(ids, posting.ID)
		sources[posting.ID] = posting.Source
	}
	return ids, sources
}

func TestSaveDropsForgedSyncRowsAndMergesStored(t *testing.T) {
	store := openTestStore(t)
	if err := store.SaveDocument(ownerDocument()); err != nil {
		t.Fatalf("save owner document: %v", err)
	}
	seedSyncRows(t, store)

	forged := ownerDocument()
	forged.Checkpoints[0].Source = SourceSimpleFIN
	prime := "prime_card"
	forged.Postings = append(forged.Postings, types.Posting{
		ID: "sfin-pending-prime_card-forged", Label: "Forged", SourceAccountID: &prime, Source: SourceSimpleFIN,
		Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "999"}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency: types.FrequencyOnce, StartDate: "2026-08-03", Priority: 6,
	})
	if err := store.SaveDocument(forged); err != nil {
		t.Fatalf("save forged document: %v", err)
	}

	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v, want owner + synced", loaded.Checkpoints)
	}
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.Source != SourceModel && checkpoint.Source != SourceSimpleFIN {
			t.Fatalf("checkpoint source = %q", checkpoint.Source)
		}
		if checkpoint.AccountID == "checking" && checkpoint.Date == "2026-07-01" && checkpoint.Source != SourceModel {
			t.Fatalf("forged checkpoint flag persisted: %+v", checkpoint)
		}
	}
	ids, sources := loadPostingIDs(t, store)
	for _, id := range ids {
		if id == "sfin-pending-prime_card-forged" {
			t.Fatalf("forged sync posting persisted: %v", ids)
		}
	}
	if sources["sfin-pending-prime_card-tx1"] != SourceSimpleFIN {
		t.Fatalf("stored sync posting lost flag: %v", sources)
	}
	if sources["owner-charge"] != SourceModel {
		t.Fatalf("owner posting flag = %q", sources["owner-charge"])
	}
}

func TestOwnerCheckpointWinsKeyCollision(t *testing.T) {
	store := openTestStore(t)
	if err := store.SaveDocument(ownerDocument()); err != nil {
		t.Fatalf("save owner document: %v", err)
	}
	seedSyncRows(t, store)

	correction := ownerDocument()
	correction.Checkpoints = append(correction.Checkpoints, types.Checkpoint{
		Date: "2026-08-01", AccountID: "checking", Balance: 222,
	})
	if err := store.SaveDocument(correction); err != nil {
		t.Fatalf("save correction: %v", err)
	}

	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	count := 0
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.Date == "2026-08-01" {
			count++
			if checkpoint.Balance != 222 || checkpoint.Source != SourceModel {
				t.Fatalf("collision row = %+v, want owner correction", checkpoint)
			}
		}
	}
	if count != 1 {
		t.Fatalf("collision key rows = %d, want 1", count)
	}
}

func TestRoundTripPreservesSyncRows(t *testing.T) {
	store := openTestStore(t)
	if err := store.SaveDocument(ownerDocument()); err != nil {
		t.Fatalf("save owner document: %v", err)
	}
	seedSyncRows(t, store)

	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load document: %v", err)
	}
	if err := store.SaveDocument(loaded); err != nil {
		t.Fatalf("save round-tripped document: %v", err)
	}

	again, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("reload document: %v", err)
	}
	if !reflect.DeepEqual(again.Checkpoints, loaded.Checkpoints) {
		t.Fatalf("round trip changed checkpoints:\n got %+v\nwant %+v", again.Checkpoints, loaded.Checkpoints)
	}
	gotIDs, _ := loadPostingIDs(t, store)
	wantIDs := []string{}
	for _, posting := range loaded.Postings {
		wantIDs = append(wantIDs, posting.ID)
	}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("round trip changed postings: got %v, want %v", gotIDs, wantIDs)
	}
}

func TestOpenMigratesVersionTwoSourceColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "version-two.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open version two database: %v", err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin version two database: %v", err)
	}
	if err := migrateV1(tx); err != nil {
		t.Fatalf("create version one schema: %v", err)
	}
	if err := migrateV2(tx); err != nil {
		t.Fatalf("create version two schema: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE schema_version (version INTEGER NOT NULL)`,
		`INSERT INTO schema_version (version) VALUES (1)`,
		`INSERT INTO schema_version (version) VALUES (2)`,
		`INSERT INTO accounts (id, position, label, enabled) VALUES ('checking', 0, 'Checking', 1)`,
		`INSERT INTO checkpoints (position, date, account_id, balance) VALUES (0, '2026-04-30', 'checking', 200)`,
		`UPDATE model_metadata SET document_present = 1 WHERE id = 1`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("seed version two database: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit version two database: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close version two database: %v", err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	document, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load migrated document: %v", err)
	}
	if document == nil || len(document.Checkpoints) != 1 {
		t.Fatalf("migrated document = %+v", document)
	}
	checkpoint := document.Checkpoints[0]
	if checkpoint.Balance != 200 || checkpoint.Source != SourceModel {
		t.Fatalf("migrated checkpoint = %+v, want balance 200 source model", checkpoint)
	}
	var version int
	if err := store.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil || version != 3 {
		t.Fatalf("migrated schema version = %d, err %v", version, err)
	}
}

func syncPendingPosting(id, accountID, day string) types.Posting {
	return types.Posting{
		ID:              id,
		Label:           "Pending",
		SourceAccountID: &accountID,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency:       types.FrequencyOnce,
		StartDate:       types.IsoDate(day),
		Priority:        6,
	}
}

func countRows(t *testing.T, store *Store, table, where string) int {
	t.Helper()
	var count int
	query := `SELECT COUNT(*) FROM ` + table
	if where != "" {
		query += ` WHERE ` + where
	}
	if err := store.db.QueryRow(query).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return count
}

func TestApplySyncPlanCheckpointLifecycle(t *testing.T) {
	store := openTestStore(t)
	cards := []string{"prime_card"}

	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, cards, false,
	)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}

	again, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, cards, false,
	)
	if err != nil || again.CheckpointsUpdated != 1 || again.CheckpointsInserted != 0 {
		t.Fatalf("rerun = %+v, err %v", again, err)
	}

	changed, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 150}},
		nil, cards, false,
	)
	if err != nil || changed.CheckpointsUpdated != 1 {
		t.Fatalf("update = %+v, err %v", changed, err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_ = loaded
	var balance float64
	var source string
	if err := store.db.QueryRow(
		`SELECT balance, source FROM checkpoints WHERE account_id = 'checking' AND date = '2026-08-05'`,
	).Scan(&balance, &source); err != nil || balance != 150 || source != SourceSimpleFIN {
		t.Fatalf("checkpoint = %v %q, err %v", balance, source, err)
	}
}

func TestApplySyncPlanSkipsUserCheckpoint(t *testing.T) {
	store := openTestStore(t)
	execSyncSetup(t, store, []string{
		`INSERT INTO accounts (id, position, label, enabled) VALUES ('checking', 0, 'Checking', 1)`,
		`INSERT INTO checkpoints (position, date, account_id, balance, source) VALUES (0, '2026-08-05', 'checking', 999, 'model')`,
	})
	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		nil, []string{"checking"}, false,
	)
	if err != nil || summary.CheckpointsSkipped != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	var balance float64
	if err := store.db.QueryRow(
		`SELECT balance FROM checkpoints WHERE account_id = 'checking' AND date = '2026-08-05'`,
	).Scan(&balance); err != nil || balance != 999 {
		t.Fatalf("user checkpoint overwritten: %v, err %v", balance, err)
	}
}

func TestApplySyncPlanRefreshesPendingSnapshot(t *testing.T) {
	store := openTestStore(t)
	cards := []string{"prime_card"}

	first, err := store.ApplySyncPlan(nil, []types.Posting{
		syncPendingPosting("sfin-pending-prime_card-a", "prime_card", "2026-08-02"),
		syncPendingPosting("sfin-pending-prime_card-b", "prime_card", "2026-08-02"),
	}, cards, false)
	if err != nil || first.PendingInserted != 2 {
		t.Fatalf("first apply = %+v, err %v", first, err)
	}

	second, err := store.ApplySyncPlan(nil, []types.Posting{
		syncPendingPosting("sfin-pending-prime_card-b", "prime_card", "2026-08-03"),
		syncPendingPosting("sfin-pending-prime_card-c", "prime_card", "2026-08-03"),
	}, cards, false)
	if err != nil || second.PendingDeleted != 2 || second.PendingInserted != 2 {
		t.Fatalf("second apply = %+v, err %v", second, err)
	}
	if got := countRows(t, store, "postings", "id LIKE 'sfin-pending-%'"); got != 2 {
		t.Fatalf("pending rows = %d, want 2", got)
	}
	if got := countRows(t, store, "postings", "id = 'sfin-pending-prime_card-a'"); got != 0 {
		t.Fatal("stale pending row survived refresh")
	}
}

func TestApplySyncPlanPendingDeleteSparesUserRows(t *testing.T) {
	store := openTestStore(t)
	execSyncSetup(t, store, []string{
		`INSERT INTO postings (id, position, label, source_account_id, destinations, amount_json, frequency, annual_rate, annual_growth_rate, volatility, start_date, priority, enabled, source)
		 VALUES ('sfin-pending-prime_card-manual', 0, 'Manual', 'prime_card', 'null', '` + syncTestAmountJSON + `', 'once', 0, 0, 0, '2026-08-02', 6, 1, 'model')`,
	})
	summary, err := store.ApplySyncPlan(nil, []types.Posting{
		syncPendingPosting("sfin-pending-prime_card-a", "prime_card", "2026-08-02"),
	}, []string{"prime_card"}, false)
	if err != nil || summary.PendingInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "postings", "id = 'sfin-pending-prime_card-manual'"); got != 1 {
		t.Fatal("user row with colliding prefix was deleted")
	}
}

func TestApplySyncPlanDryRunWritesNothing(t *testing.T) {
	store := openTestStore(t)
	summary, err := store.ApplySyncPlan(
		[]SyncCheckpoint{{AccountID: "checking", Date: "2026-08-05", Balance: 100}},
		[]types.Posting{syncPendingPosting("sfin-pending-prime_card-a", "prime_card", "2026-08-02")},
		[]string{"prime_card"}, true,
	)
	if err != nil || !summary.DryRun || summary.CheckpointsInserted != 1 || summary.PendingInserted != 1 {
		t.Fatalf("dry run = %+v, err %v", summary, err)
	}
	if got := countRows(t, store, "checkpoints", ""); got != 0 {
		t.Fatalf("dry run wrote %d checkpoints", got)
	}
	if got := countRows(t, store, "postings", ""); got != 0 {
		t.Fatalf("dry run wrote %d postings", got)
	}
}
