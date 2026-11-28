package main

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedSettled(t *testing.T, scoped store.Store) string {
	t.Helper()
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	source := "checking"
	settled := types.Transaction{
		Name:            "BANK OF AMERICA ONLINE PMT",
		Source:          store.SourceBankSync,
		SourceAccountID: &source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "363.62"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1794657600,
		TransactionTime: 1794657600,
		Enabled:         true,
	}
	directive := store.BankDirective{Upsert: &store.BankUpsert{
		Transaction: settled,
		Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-checking", TransactionID: "post1"}},
	}}
	summary, err := scoped.ApplySync(nil, []store.BankDirective{directive})
	if err != nil {
		t.Fatal(err)
	}
	if summary.SettledInserted != 1 {
		t.Fatalf("seed = %+v", summary)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Transactions) != 1 {
		t.Fatalf("rows = %d", len(model.Transactions))
	}
	return model.Transactions[0].ID
}

func corruptPostedTime(t *testing.T, path, id string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`UPDATE transactions SET posted_time = 0 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
}

func TestUpgradeRepairsZeroedPostedTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	id := seedSettled(t, scoped)
	db.Close()

	corruptPostedTime(t, path, id)

	dry, err := upgrade(path, true)
	if err != nil {
		t.Fatal(err)
	}
	if dry != 1 {
		t.Fatalf("dry run repairable = %d, want 1", dry)
	}

	repaired, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if repaired != 1 {
		t.Fatalf("repaired = %d, want 1", repaired)
	}

	db2, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	scoped2, err := db2.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	model, err := scoped2.LoadModel()
	if err != nil {
		t.Fatalf("model still invalid after repair: %v", err)
	}
	if len(model.Transactions) != 1 || model.Transactions[0].PostedTime != 1794657600 {
		t.Fatalf("posted time not restored: %+v", model.Transactions)
	}

	again, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if again != 0 {
		t.Fatalf("repeat repair = %d, want 0", again)
	}
}

func TestUpgradeLeavesValidPendingSeeds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	source := "checking"
	pending := types.Transaction{
		Name:            "Pending charge",
		Source:          store.SourceBankSync,
		SourceAccountID: &source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      0,
		TransactionTime: 1794657600,
		Enabled:         false,
		Pending:         true,
	}
	summary, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
		Transaction: pending,
		Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-checking", TransactionID: "pend1"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if summary.PendingInserted != 1 {
		t.Fatalf("seed = %+v", summary)
	}
	db.Close()

	repaired, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if repaired != 0 {
		t.Fatalf("pending seeds must not be repaired: %d", repaired)
	}
}

func TestUpgradeLeavesNonBankRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	const ownerID = "01900000-0000-7000-8000-000000000092"
	if _, err := scoped.CreateTransaction(types.Transaction{
		ID:              ownerID,
		Name:            "Owner row without posted time",
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		TransactionTime: 1794657600,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}
	db.Close()
	const projectedID = "01900000-0000-7000-8000-000000000093"
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`INSERT INTO transactions(user_id,id,name,amount_resolution_json,posted_time,transaction_time,source,pending,void)
		SELECT id, ?, 'Projected row without posted time', '{}', 0, 1794657600, 'projected', 0, 0 FROM users`, projectedID); err != nil {
		t.Fatal(err)
	}
	conn.Close()

	repaired, err := upgrade(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if repaired != 0 {
		t.Fatalf("non-bank rows must not be repaired: %d", repaired)
	}
	conn, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for _, id := range []string{ownerID, projectedID} {
		var posted int64
		if err := conn.QueryRow(`SELECT posted_time FROM transactions WHERE id = ?`, id).Scan(&posted); err != nil {
			t.Fatal(err)
		}
		if posted != 0 {
			t.Fatalf("non-bank posted time for %s = %d, want 0", id, posted)
		}
	}
}

func TestUpgradeRejectsUnrepairableBankRowWithoutWriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	id := seedSettled(t, scoped)
	db.Close()
	corruptPostedTime(t, path, id)
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`UPDATE transactions SET transaction_time = 0 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := upgrade(path, false); err == nil || !strings.Contains(err.Error(), "no valid transaction time") {
		t.Fatalf("upgrade error = %v, want unusable transaction time", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("unrepairable input changed the database file")
	}
}

func TestUpgradeRejectsHotJournalWithoutWriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := os.WriteFile(path+"-journal", []byte("hot"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := upgrade(path, true); err == nil || !strings.Contains(err.Error(), "hot rollback journal") {
		t.Fatalf("upgrade error = %v, want hot journal refusal", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("hot journal refusal changed the database file")
	}
}
