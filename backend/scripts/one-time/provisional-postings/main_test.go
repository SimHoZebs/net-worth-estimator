package main

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestUpgradeCreatesSatelliteAndBackfillsLegacyClaimsOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser("alice", "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	account := "checking"
	if _, err := scoped.CreateAccount(types.Account{ID: account, Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateSchedule(types.Schedule{
		ID: "rent", Name: "Rent", SourceAccountID: &account, Enabled: true, StartDate: "2026-04-01",
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		Amount:     types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
	}); err != nil {
		t.Fatal(err)
	}

	seedBank := func(name, key, amount string, pending bool, occurred, posted int64) string {
		t.Helper()
		row := types.Transaction{
			Name: name, Source: store.SourceBankSync, SourceAccountID: &account, Enabled: !pending, Pending: pending,
			TransactionTime: occurred, PostedTime: posted,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}},
		}
		if _, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
			Transaction: row,
			Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-checking", TransactionID: key}},
		}}}); err != nil {
			t.Fatal(err)
		}
		model, err := scoped.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		for _, transaction := range model.Transactions {
			if transaction.Name == name {
				return transaction.ID
			}
		}
		t.Fatalf("seeded row %q missing from %+v", name, model.Transactions)
		return ""
	}
	const occurred = int64(1775044800) // 2026-04-01 12:00 UTC
	const posted = occurred + 3600
	pendingID := seedBank("pending-derived", "pend", "100", true, occurred, 0)
	equalID := seedBank("settled-equal", "equal", "100", false, occurred, occurred)
	laterID := seedBank("settled-later", "later", "100", false, occurred, posted)
	unclaimedID := seedBank("unclaimed-equal", "unclaimed", "100", false, occurred, occurred)
	for _, id := range []string{pendingID, equalID, laterID} {
		if _, err := scoped.SetTransactionClaims([]types.TransactionClaimUpdate{{
			TransactionID: id,
			Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
		}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := scoped.CreateTransaction(types.Transaction{
		ID: "01900000-0000-7000-8000-000000000001", Name: "owner-equal", SourceAccountID: &account,
		TransactionTime: occurred, PostedTime: occurred, Enabled: true,
		Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
		Claim:  &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
	}); err != nil {
		t.Fatal(err)
	}
	before, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range before.Transactions {
		if row.ID == pendingID && !row.PostedTimeProvisional {
			t.Fatalf("pending-derived claim did not start provisional: %+v", row)
		}
	}
	transactionsBefore := transactionSnapshot(t, path)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	execSQL(t, path, `DROP TABLE transaction_provisional_postings;`)

	result, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Created || result.Backfilled != 2 {
		t.Fatalf("upgrade = %+v, want created satellite with two legacy markers", result)
	}
	if got := transactionSnapshot(t, path); got != transactionsBefore {
		t.Fatalf("transaction rows changed during satellite upgrade:\nbefore %s\nafter %s", transactionsBefore, got)
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
	bank, err := scoped2.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	wantProvisional := map[string]bool{pendingID: true, equalID: true, laterID: false, unclaimedID: false}
	for _, row := range bank {
		if row.Transaction.PostedTimeProvisional != wantProvisional[row.Transaction.ID] {
			t.Fatalf("row %s provisional = %v, want %v", row.Transaction.Name, row.Transaction.PostedTimeProvisional, wantProvisional[row.Transaction.ID])
		}
	}
	model, err := scoped2.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range model.Transactions {
		if row.Name == "owner-equal" && row.PostedTimeProvisional {
			t.Fatalf("owner row acquired provisional state: %+v", row)
		}
	}

	// A later owner decision can clear an ambiguous legacy marker. Once the
	// satellite exists, subsequent deployments must not re-run equality matching.
	execSQL(t, path, `DELETE FROM transaction_provisional_postings WHERE transaction_id = '`+equalID+`';`)
	markersBefore := queryValue(t, path, `SELECT user_id || '/' || transaction_id FROM transaction_provisional_postings ORDER BY 1;`)
	repeat, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if repeat.Created || repeat.Backfilled != 0 {
		t.Fatalf("repeat = %+v, want verification only", repeat)
	}
	if got := queryValue(t, path, `SELECT user_id || '/' || transaction_id FROM transaction_provisional_postings ORDER BY 1;`); got != markersBefore {
		t.Fatalf("repeat changed marker rows: before %q after %q", markersBefore, got)
	}
}

func TestUpgradeRejectsMalformedExistingSatelliteWithoutChangingIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	execSQL(t, path, `DROP TABLE transaction_provisional_postings;
		CREATE TABLE transaction_provisional_postings(
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			transaction_id TEXT NOT NULL,
			FOREIGN KEY(transaction_id, user_id) REFERENCES transactions(id, user_id) ON DELETE CASCADE,
			PRIMARY KEY(user_id, transaction_id)
		);`)
	before := queryValue(t, path, `SELECT sql FROM sqlite_master WHERE name = 'transaction_provisional_postings';`)
	if _, err := upgrade(path); err == nil {
		t.Fatal("malformed satellite was accepted")
	}
	if after := queryValue(t, path, `SELECT sql FROM sqlite_master WHERE name = 'transaction_provisional_postings';`); after != before {
		t.Fatalf("malformed satellite changed: before %q after %q", before, after)
	}
}

func execSQL(t *testing.T, path, statement string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
}

func queryValue(t *testing.T, path, query string) string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRow(query).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func transactionSnapshot(t *testing.T, path string) string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query(`SELECT user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, projection_slice_id, event_json, applied_amount, outcome FROM transactions ORDER BY user_id, id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var snapshot string
	for rows.Next() {
		var userID, id, name, destinations, amount, source string
		var sourceAccount, sliceID, eventJSON, outcome sql.NullString
		var posted, transacted int64
		var pending, voided int64
		var applied sql.NullFloat64
		if err := rows.Scan(&userID, &id, &name, &sourceAccount, &destinations, &amount, &posted, &transacted, &source, &pending, &voided, &sliceID, &eventJSON, &applied, &outcome); err != nil {
			t.Fatal(err)
		}
		snapshot += fmt.Sprintf("%s|%s|%s|%v|%s|%s|%d|%d|%s|%d|%d|%v|%v|%v|%v\n", userID, id, name, sourceAccount, destinations, amount, posted, transacted, source, pending, voided, sliceID, eventJSON, applied, outcome)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return snapshot
}
