package main

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
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

	seedBank := func(name, key, amount string, pending bool, occurred, posted int64, facts *types.TransactionFacts) string {
		t.Helper()
		row := types.Transaction{
			Name: name, Source: store.SourceBankSync, SourceAccountID: &account, Enabled: !pending, Pending: pending,
			TransactionTime: occurred, PostedTime: posted,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}},
		}
		if _, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
			Transaction: row,
			Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-checking", TransactionID: key}},
			Facts:       facts,
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
	pendingID := seedBank("pending-derived", "pend", "100", true, occurred, 0, &types.TransactionFacts{Pending: true, PostedTime: 0})
	equalID := seedBank("settled-equal", "equal", "100", false, occurred, occurred, &types.TransactionFacts{Pending: false, PostedTime: occurred})
	laterID := seedBank("settled-later", "later", "100", false, occurred, posted, &types.TransactionFacts{Pending: false, PostedTime: posted})
	missingID := seedBank("settled-equal-without-facts", "missing", "100", false, occurred, occurred, nil)
	unclaimedID := seedBank("unclaimed-equal", "unclaimed", "100", false, occurred, occurred, &types.TransactionFacts{Pending: false, PostedTime: occurred})
	for _, id := range []string{pendingID, equalID, laterID, missingID} {
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
		if row.ID == equalID {
			row.Name = "Owner edited settled grocer"
			row.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "125"}}
			row.Enabled = false
			if _, err := scoped.UpdateTransaction(row); err != nil {
				t.Fatalf("owner edit: %v", err)
			}
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
	if !result.Created || result.Backfilled != 1 {
		t.Fatalf("upgrade = %+v, want created satellite with one pending-evidence marker", result)
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
	wantProvisional := map[string]bool{pendingID: true, equalID: false, laterID: false, missingID: false, unclaimedID: false}
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

	// A known-settled equal-date claim keeps its owner edits and exclusion when
	// the same bank key posts again. Only an explicit marker permits that write.
	var settled store.BankRow
	for _, row := range bank {
		if row.Transaction.ID == equalID {
			settled = row
		}
	}
	if settled.Transaction.Name != "Owner edited settled grocer" || settled.Transaction.Enabled || settled.Transaction.PostedTimeProvisional {
		t.Fatalf("settled owner state changed during migration: %+v", settled.Transaction)
	}
	if expression, _ := settled.Transaction.Amount.Config["expression"].(string); expression != "125" {
		t.Fatalf("settled owner amount changed during migration: %q", expression)
	}
	facts := types.TransactionFacts{Description: "BANK FINAL GROCER", Amount: "-110.00", PostedTime: occurred}
	incoming := store.SyncTransaction{
		ProviderAccountID: "bridge-checking",
		TransactionID:     "equal",
		Transaction: types.Transaction{
			Name: "BANK FINAL GROCER", Source: store.SourceBankSync, SourceAccountID: &account, Enabled: true,
			TransactionTime: occurred, PostedTime: occurred,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "110"}},
		},
		Facts: &facts,
	}
	directives := simplefin.Reconcile(nil, []store.SyncTransaction{incoming}, bank, map[string]bool{"checking": true})
	for _, directive := range directives {
		if directive.Upsert != nil || directive.Convert != nil || directive.Void != "" {
			t.Fatalf("same-key settled sync would overwrite the owner-edited claim: %+v", directive)
		}
	}
	if summary, err := scoped2.ApplySync(nil, directives); err != nil || summary != (store.SyncApplySummary{}) {
		t.Fatalf("same-key settled sync = %+v, err %v, want evidence-only no-op", summary, err)
	}
	afterSync, err := scoped2.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	foundSettled := false
	for _, row := range afterSync {
		if row.Transaction.ID != equalID {
			continue
		}
		foundSettled = true
		expression, _ := row.Transaction.Amount.Config["expression"].(string)
		if row.Transaction.Name != "Owner edited settled grocer" || expression != "125" || row.Transaction.Enabled || row.Transaction.PostedTimeProvisional || row.Transaction.Claim == nil {
			t.Fatalf("same-key settled sync changed owner state: %+v", row.Transaction)
		}
	}
	if !foundSettled {
		t.Fatal("same-key settled sync removed the owner-edited claim")
	}

	// A later owner decision can clear a pending-evidence marker. Once the
	// satellite exists, subsequent deployments must not rerun classification.
	execSQL(t, path, `DELETE FROM transaction_provisional_postings WHERE transaction_id = '`+pendingID+`';`)
	markersBefore := queryValue(t, path, `SELECT COALESCE(group_concat(marker, ''), '') FROM (SELECT user_id || '/' || transaction_id AS marker FROM transaction_provisional_postings ORDER BY 1);`)
	repeat, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if repeat.Created || repeat.Backfilled != 0 {
		t.Fatalf("repeat = %+v, want verification only", repeat)
	}
	if got := queryValue(t, path, `SELECT COALESCE(group_concat(marker, ''), '') FROM (SELECT user_id || '/' || transaction_id AS marker FROM transaction_provisional_postings ORDER BY 1);`); got != markersBefore {
		t.Fatalf("repeat changed marker rows: before %q after %q", markersBefore, got)
	}
}

func TestUpgradeRequiresPendingTrueAndNumericZeroPostedTime(t *testing.T) {
	for _, test := range []struct {
		name      string
		facts     string
		hasFacts  bool
		pending   bool
		malformed bool
	}{
		{name: "missing facts", hasFacts: false},
		{name: "zero without pending", facts: `{"postedTime":0}`, hasFacts: true},
		{name: "legacy pending false", facts: `{"pending":false,"postedTime":0}`, hasFacts: true},
		{name: "null pending", facts: `{"pending":null,"postedTime":0}`, hasFacts: true},
		{name: "string pending", facts: `{"pending":"true","postedTime":0}`, hasFacts: true},
		{name: "numeric pending", facts: `{"pending":1,"postedTime":0}`, hasFacts: true},
		{name: "pending zero", facts: `{"pending":true,"postedTime":0}`, hasFacts: true, pending: true},
		{name: "pending negative zero", facts: `{"pending":true,"postedTime":-0}`, hasFacts: true, pending: true},
		{name: "pending decimal zero", facts: `{"pending":true,"postedTime":0.0}`, hasFacts: true, pending: true},
		{name: "pending exponent zero", facts: `{"pending":true,"postedTime":0e100}`, hasFacts: true, pending: true},
		{name: "pending positive", facts: `{"pending":true,"postedTime":1775044800}`, hasFacts: true},
		{name: "settled positive", facts: `{"pending":false,"postedTime":1775044800}`, hasFacts: true},
		{name: "pending absent posted", facts: `{"pending":true}`, hasFacts: true},
		{name: "pending null posted", facts: `{"pending":true,"postedTime":null}`, hasFacts: true},
		{name: "pending string zero", facts: `{"pending":true,"postedTime":"0"}`, hasFacts: true},
		{name: "pending boolean posted", facts: `{"pending":true,"postedTime":false}`, hasFacts: true},
		{name: "pending array posted", facts: `{"pending":true,"postedTime":[]}`, hasFacts: true},
		{name: "pending object posted", facts: `{"pending":true,"postedTime":{}}`, hasFacts: true},
		{name: "pending negative", facts: `{"pending":true,"postedTime":-1}`, hasFacts: true},
		{name: "pending tiny nonzero", facts: `{"pending":true,"postedTime":1e-400}`, hasFacts: true},
		{name: "absent fields", facts: `{}`, hasFacts: true},
		{name: "null document", facts: `null`, hasFacts: true},
		{name: "array document", facts: `[]`, hasFacts: true},
		{name: "truncated", facts: `{"pending":true,"postedTime":`, hasFacts: true, malformed: true},
		{name: "trailing text", facts: `{"pending":true,"postedTime":0} trailing`, hasFacts: true, malformed: true},
		{name: "multiple values", facts: `{"pending":true,"postedTime":0}{"pending":false}`, hasFacts: true, malformed: true},
		{name: "empty", facts: ``, hasFacts: true, malformed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path, transactionID := seedLegacyEqualDateClaim(t)
			if test.hasFacts {
				execSQL(t, path, `DROP TRIGGER analysis_facts_insert;
					INSERT INTO transaction_source_facts(user_id, transaction_id, facts_json)
					SELECT user_id, id, '`+test.facts+`' FROM transactions WHERE id = '`+transactionID+`';`)
			}
			transactionsBefore := transactionSnapshot(t, path)
			result, err := upgrade(path)
			if test.malformed {
				if err == nil || !strings.Contains(err.Error(), "malformed source facts JSON") || !strings.Contains(err.Error(), transactionID) {
					t.Fatalf("upgrade error = %v, want malformed candidate facts failure for %s", err, transactionID)
				}
				if got := queryValue(t, path, `SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='transaction_provisional_postings';`); got != "0" {
					t.Fatalf("failed upgrade published %s provisional satellite rows", got)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				want := 0
				if test.pending {
					want = 1
				}
				if !result.Created || result.Backfilled != want {
					t.Fatalf("upgrade = %+v, want created satellite with %d pending-evidence markers", result, want)
				}
				if got := queryValue(t, path, `SELECT COUNT(*) FROM transaction_provisional_postings;`); got != fmt.Sprint(want) {
					t.Fatalf("markers = %s, want %d", got, want)
				}
			}
			if got := transactionSnapshot(t, path); got != transactionsBefore {
				t.Fatalf("transaction rows changed during satellite upgrade:\nbefore %s\nafter %s", transactionsBefore, got)
			}
		})
	}
}

func TestUpgradeWithoutSourceFactsLeavesEqualDateClaimsUnmarked(t *testing.T) {
	path, _ := seedLegacyEqualDateClaim(t)
	execSQL(t, path, `DROP TABLE transaction_source_facts;`)
	transactionsBefore := transactionSnapshot(t, path)

	result, err := upgrade(path)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Created || result.Backfilled != 0 {
		t.Fatalf("upgrade = %+v, want empty satellite without source facts", result)
	}
	if got := queryValue(t, path, `SELECT COUNT(*) FROM transaction_provisional_postings;`); got != "0" {
		t.Fatalf("unknown equal-date claim acquired %s markers", got)
	}
	if got := transactionSnapshot(t, path); got != transactionsBefore {
		t.Fatalf("transaction rows changed during satellite upgrade:\nbefore %s\nafter %s", transactionsBefore, got)
	}
}

func seedLegacyEqualDateClaim(t *testing.T) (string, string) {
	t.Helper()
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
	const occurred = int64(1775044800)
	if _, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
		Transaction: types.Transaction{
			Name: "settled-equal", Source: store.SourceBankSync, SourceAccountID: &account, Enabled: true,
			TransactionTime: occurred, PostedTime: occurred,
			Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
		},
		Keys: []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-checking", TransactionID: "equal"}},
	}}}); err != nil {
		t.Fatal(err)
	}
	model, err := scoped.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatalf("seeded rows = %+v, err %v", model, err)
	}
	transactionID := model.Transactions[0].ID
	if _, err := scoped.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: transactionID,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	execSQL(t, path, `DROP TABLE transaction_provisional_postings;`)
	return path, transactionID
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
