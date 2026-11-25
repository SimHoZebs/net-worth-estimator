package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func bankKeys(provider, account, transaction string) []BankKey {
	return []BankKey{{Provider: provider, AccountID: account, TransactionID: transaction}}
}

func bankSeedTransaction(name, account, amount string, pending bool) types.Transaction {
	source := &account
	posted := int64(1785628800)
	if pending {
		posted = 0
	}
	return types.Transaction{
		Name:            name,
		Source:          SourceBankSync,
		SourceAccountID: source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      posted,
		TransactionTime: 1785628800,
		Enabled:         !pending,
		Pending:         pending,
	}
}

func bankUpsertDirective(transaction types.Transaction, provider, account, bankTransactionID string) BankDirective {
	return BankDirective{Upsert: &BankUpsert{
		Transaction: transaction,
		Keys:        bankKeys(provider, account, bankTransactionID),
	}}
}

func applyDirectives(t *testing.T, database store.Store, directives []BankDirective) SyncApplySummary {
	t.Helper()
	summary, err := database.ApplySync(nil, directives)
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func TestClaimedPendingSurvivesBankRefresh(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedTransaction("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")
	if first := applyDirectives(t, database, []BankDirective{upsert}); first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Transactions[0].ID
	if _, err := database.CreateSchedule(testRuleFixture("rent")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: id,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-08-02"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	// The bank still shows the authorization as pending: the refresh must
	// not demote the claimed occurrence back to a disabled seed.
	if second := applyDirectives(t, database, []BankDirective{upsert}); second.PendingUpdated != 1 {
		t.Fatalf("refresh = %+v", second)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", after, err)
	}
	row := after.Transactions[0]
	if row.ID != id {
		t.Fatalf("refresh changed identity: %s", row.ID)
	}
	if row.Pending || !row.Enabled {
		t.Fatalf("claimed row demoted by refresh: %+v", row)
	}
	if row.PostedTime != row.TransactionTime || !row.PostedTimeProvisional {
		t.Fatalf("claimed provisional posting changed on pending refresh: %+v", row)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "rent" {
		t.Fatalf("claim lost on refresh: %+v", row)
	}
}

func TestClaimedSettledPreservesPostedTimeOnPendingRefresh(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	settled := bankSeedTransaction("BANK OF AMERICA ONLINE PMT", "prime_card", "363.62", false)
	settled.PostedTime = 1794657600
	settled.TransactionTime = 1794657600
	if first := applyDirectives(t, database, []BankDirective{bankUpsertDirective(settled, ProviderSimpleFIN, "bridge-prime", "post1")}); first.SettledInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Transactions[0].ID
	if _, err := database.CreateSchedule(testRuleFixture("rent")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: id,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-14"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	// The bridge still reports the authorization as pending with no posted
	// date. The claimed occurrence must keep its verified posted instant so
	// the model stays valid and balances keep serving.
	pendingRefresh := bankSeedTransaction("BANK OF AMERICA ONLINE PMT", "prime_card", "363.62", true)
	pendingRefresh.PostedTime = 0
	pendingRefresh.TransactionTime = 1794657600
	if second := applyDirectives(t, database, []BankDirective{bankUpsertDirective(pendingRefresh, ProviderSimpleFIN, "bridge-prime", "post1")}); second.PendingUpdated != 1 {
		t.Fatalf("refresh = %+v", second)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", after, err)
	}
	row := after.Transactions[0]
	if row.ID != id {
		t.Fatalf("refresh changed identity: %s", row.ID)
	}
	if row.Pending || !row.Enabled {
		t.Fatalf("claimed row demoted by refresh: %+v", row)
	}
	if row.PostedTime != 1794657600 || row.PostedTimeProvisional {
		t.Fatalf("claimed settled posted time lost or marked provisional: %+v", row)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "rent" {
		t.Fatalf("claim lost on refresh: %+v", row)
	}
}

func TestConvertPreservesOccurrenceClaim(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(
		bankSeedTransaction("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Transactions[0].ID
	if _, err := database.CreateSchedule(testRuleFixture("rent")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: id,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-08-02"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	settled := bankSeedTransaction("Corner Store", "prime_card", "42.10", false)
	summary := applyDirectives(t, database, []BankDirective{{Convert: &BankConvert{
		ID:          id,
		Transaction: settled,
		AddKeys:     bankKeys(ProviderSimpleFIN, "bridge-prime", "post1"),
	}}})
	if summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v", summary)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", after, err)
	}
	row := after.Transactions[0]
	if row.ID != id || row.Pending || !row.Enabled || row.PostedTimeProvisional {
		t.Fatalf("converted row = %+v", row)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "rent" {
		t.Fatalf("claim lost on convert: %+v", row)
	}
	bank, err := database.LoadBankTransactions()
	if err != nil || len(bank) != 1 || len(bank[0].Keys) != 1 || bank[0].Keys[0].TransactionID != "post1" {
		t.Fatalf("keys after rotation = %+v, %v", bank, err)
	}
}

func TestSetTransactionClaimsPromotesPendingPostedTime(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	seed := bankSeedTransaction("Bistro", "prime_card", "50.00", true)
	seed.PostedTime = 0
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-prime", "pend1")})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	if _, err := database.CreateSchedule(testRuleFixture("dining")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: loaded.Transactions[0].ID,
		Claim:         types.TransactionClaim{ScheduleID: "dining", OccurrenceDate: "2026-08-02"},
	}})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %+v, err %v", claimed, err)
	}
	row := claimed[0]
	if row.Pending || !row.Enabled || row.PostedTime != row.TransactionTime || row.PostedTime <= 0 || !row.PostedTimeProvisional {
		t.Fatalf("claimed pending row = %+v, want enabled provisional occurrence at its transaction instant", row)
	}
}

func TestOwnerUpdateClearsClaimedProvisionalPosting(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	seed := bankSeedTransaction("Rent", "checking", "1000", true)
	seed.TransactionTime = autoClaimNoon("2026-04-01")
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-checking", "pend-apr")})
	model, err := database.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", model, err)
	}
	if _, err := database.CreateSchedule(autoClaimSchedule("rent", "checking")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: model.Transactions[0].ID,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
	}})
	if err != nil || len(claimed) != 1 || !claimed[0].PostedTimeProvisional {
		t.Fatalf("claim = %+v, err %v", claimed, err)
	}

	edited := claimed[0]
	edited.Name = "Owner confirmed rent"
	edited.PostedTime = edited.TransactionTime
	edited, err = database.UpdateTransaction(edited)
	if err != nil {
		t.Fatalf("owner edit = %v", err)
	}
	if edited.PostedTimeProvisional || edited.PostedTime != edited.TransactionTime {
		t.Fatalf("owner edit did not confirm posted instant: %+v", edited)
	}
	refresh := bankSeedTransaction("Rent", "checking", "1000", true)
	refresh.TransactionTime = edited.TransactionTime
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(refresh, ProviderSimpleFIN, "bridge-checking", "pend-apr")})
	after, err := database.LoadBankTransactions()
	if err != nil || len(after) != 1 {
		t.Fatalf("refresh = %+v, err %v", after, err)
	}
	if after[0].Transaction.PostedTimeProvisional || after[0].Transaction.PostedTime != edited.PostedTime {
		t.Fatalf("pending refresh changed owner-confirmed posted instant: %+v", after[0].Transaction)
	}
}

func TestCreateOwnerTransactionNeverPersistsProvisionalPosting(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	created, err := database.CreateTransaction(types.Transaction{
		Name: "Owner", SourceAccountID: &[]string{"checking"}[0],
		Amount:     types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}},
		PostedTime: 1785628800, TransactionTime: 1785628800, Enabled: true, PostedTimeProvisional: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.PostedTimeProvisional {
		t.Fatalf("owner create returned provisional state: %+v", created)
	}
	if got := countRows(t, database, "transaction_provisional_postings", ""); got != 0 {
		t.Fatalf("owner create persisted %d provisional markers", got)
	}
}

func TestDeleteScheduleClearsClaimedProvisionalPosting(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	seed := bankSeedTransaction("Rent", "checking", "1000", true)
	seed.TransactionTime = autoClaimNoon("2026-04-01")
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-checking", "pend-apr")})
	model, err := database.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", model, err)
	}
	if _, err := database.CreateSchedule(autoClaimSchedule("rent", "checking")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: model.Transactions[0].ID,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	if err := database.DeleteSchedule("rent"); err != nil {
		t.Fatalf("delete rule = %v", err)
	}
	after, err := database.LoadBankTransactions()
	if err != nil || len(after) != 1 {
		t.Fatalf("bank rows = %+v, err %v", after, err)
	}
	if after[0].Transaction.Claim != nil || after[0].Transaction.PostedTimeProvisional {
		t.Fatalf("provisional marker survived claim removal: %+v", after[0].Transaction)
	}
}

func TestImportModelPreservesClaimedBankProvisionalPosting(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	seed := bankSeedTransaction("Rent", "checking", "1000", true)
	seed.TransactionTime = autoClaimNoon("2026-04-01")
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-checking", "pend-apr")})
	model, err := database.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", model, err)
	}
	if _, err := database.CreateSchedule(autoClaimSchedule("rent", "checking")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetTransactionClaims([]types.TransactionClaimUpdate{{
		TransactionID: model.Transactions[0].ID,
		Claim:         types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-04-01"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	before, err := database.LoadBankTransactions()
	if err != nil || len(before) != 1 || !before[0].Transaction.PostedTimeProvisional {
		t.Fatalf("claimed bank row = %+v, err %v", before, err)
	}

	model, err = database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	model.Transactions = append(model.Transactions, types.Transaction{
		ID: "01900000-0000-7000-8000-000000000002", Name: "Imported owner", SourceAccountID: &[]string{"checking"}[0],
		Amount:     types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}},
		PostedTime: autoClaimNoon("2026-05-01"), TransactionTime: autoClaimNoon("2026-05-01"), Enabled: true,
		PostedTimeProvisional: true,
		Claim:                 &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-05-01"},
	})
	if _, err := database.ImportModel(model); err != nil {
		t.Fatalf("import model = %v", err)
	}
	after, err := database.LoadBankTransactions()
	if err != nil || len(after) != 1 {
		t.Fatalf("re-merged bank rows = %+v, err %v", after, err)
	}
	if after[0].Transaction.ID != before[0].Transaction.ID || !after[0].Transaction.PostedTimeProvisional || after[0].Transaction.PostedTime != before[0].Transaction.PostedTime {
		t.Fatalf("provisional marker lost on model save: before %+v after %+v", before[0].Transaction, after[0].Transaction)
	}
	imported, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range imported.Transactions {
		if row.Name == "Imported owner" && row.PostedTimeProvisional {
			t.Fatalf("owner import acquired provisional state: %+v", row)
		}
	}
}

func TestClaimPendingPromotesPostedTime(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	// Pending seeds carry no posted time; the bank only stamps the
	// authorization instant.
	seed := bankSeedTransaction("Bistro", "prime_card", "50.00", true)
	seed.PostedTime = 0
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-prime", "pend1")})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	if _, err := database.CreateSchedule(testRuleFixture("dining")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed := loaded.Transactions[0]
	claimed.Claim = &types.TransactionClaim{ScheduleID: "dining", OccurrenceDate: "2026-08-02"}
	updated, err := database.UpdateTransaction(claimed)
	if err != nil {
		t.Fatalf("claim = %v", err)
	}
	if updated.Pending || !updated.Enabled {
		t.Fatalf("claimed row = %+v", updated)
	}
	// The promotion takes the bank's transaction instant so the recorded
	// occurrence carries a positive posted time.
	if updated.PostedTime != updated.TransactionTime || updated.PostedTime <= 0 || !updated.PostedTimeProvisional {
		t.Fatalf("posted time not promoted as provisional: %+v", updated)
	}
	if updated.Claim == nil || updated.Claim.ScheduleID != "dining" {
		t.Fatalf("claim lost: %+v", updated)
	}
}

func TestClaimPendingWithExplicitPostedDateIsNotProvisional(t *testing.T) {
	for _, test := range []struct {
		name   string
		offset int64
	}{
		{name: "same instant"},
		{name: "later instant", offset: 3600},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openSQLiteStore(t)
			seedAccount(t, database, "prime_card")
			seed := bankSeedTransaction("Bistro", "prime_card", "50.00", true)
			applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-prime", "pend1")})
			loaded, err := database.LoadModel()
			if err != nil || len(loaded.Transactions) != 1 {
				t.Fatalf("rows = %+v, err %v", loaded, err)
			}
			if _, err := database.CreateSchedule(testRuleFixture("dining")); err != nil {
				t.Fatalf("rule = %v", err)
			}
			claimed := loaded.Transactions[0]
			claimed.Claim = &types.TransactionClaim{ScheduleID: "dining", OccurrenceDate: "2026-08-02"}
			claimed.PostedTime = claimed.TransactionTime + test.offset
			updated, err := database.UpdateTransaction(claimed)
			if err != nil {
				t.Fatalf("claim with explicit posted date: %v", err)
			}
			if updated.Pending || !updated.Enabled || updated.PostedTime != claimed.PostedTime || updated.PostedTimeProvisional {
				t.Fatalf("explicit posted date was not confirmed: %+v", updated)
			}
			if got := countRows(t, database, "transaction_provisional_postings", ""); got != 0 {
				t.Fatalf("explicit posted date persisted %d provisional markers", got)
			}
		})
	}
}

func TestBankUpsertInsertsAndUpdatesByKey(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := BankDirective{Upsert: &BankUpsert{
		Transaction: bankSeedTransaction("Corner Store", "prime_card", "42.10", true),
		Keys:        bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1"),
	}}
	first := applyDirectives(t, database, []BankDirective{upsert})
	if first.PendingInserted != 1 {
		t.Fatalf("insert = %+v", first)
	}
	before, err := database.LoadModel()
	if err != nil || len(before.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", before, err)
	}
	id := before.Transactions[0].ID
	if parsed, err := uuid.Parse(id); err != nil || parsed.Version() != 7 {
		t.Fatalf("identity is not a UUIDv7: %v", id)
	}
	updated := upsert
	updated.Upsert.Transaction.Name = "Corner Store updated"
	second := applyDirectives(t, database, []BankDirective{updated})
	if second.PendingUpdated != 1 || second.PendingInserted != 0 {
		t.Fatalf("update = %+v", second)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Transactions) != 1 || after.Transactions[0].ID != id || after.Transactions[0].Name != "Corner Store updated" {
		t.Fatalf("update changed identity or missed values: %+v", after)
	}
	// Duplicate delivery of the same key stays one row.
	third := applyDirectives(t, database, []BankDirective{upsert, upsert})
	if third.PendingUpdated != 2 {
		t.Fatalf("duplicate = %+v", third)
	}
	if got := countRows(t, database, "transactions", ""); got != 1 {
		t.Fatalf("duplicate delivery created a second row: %d", got)
	}
}

func TestBankVoidFlipsOnceAndIgnoresMissing(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	transaction := bankSeedTransaction("Pending", "prime_card", "10", true)
	transaction.Enabled = true
	applyDirectives(t, database, []BankDirective{{Upsert: &BankUpsert{
		Transaction: transaction,
		Keys:        bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1"),
	}}})
	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Transactions[0].Enabled {
		t.Fatal("void transition must start with an enabled transaction")
	}
	id := loaded.Transactions[0].ID
	first := applyDirectives(t, database, []BankDirective{{Void: id}})
	if first.PendingDeleted != 1 {
		t.Fatalf("void = %+v", first)
	}
	second := applyDirectives(t, database, []BankDirective{{Void: id}})
	if second.PendingDeleted != 0 {
		t.Fatalf("repeat void churned: %+v", second)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Transactions) != 1 || after.Transactions[0].Pending || !after.Transactions[0].Void || after.Transactions[0].Enabled {
		t.Fatalf("void row = %+v, %v", after, err)
	}
}

func TestDeleteTransactionSuppressesBankKeysAcrossSyncs(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedTransaction("Corner Store", "prime_card", "42.10", false), ProviderSimpleFIN, "bridge-prime", "post1")
	if first := applyDirectives(t, database, []BankDirective{upsert}); first.SettledInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	// Removing a bank row records its bank ids: the next feed carries the
	// same charge, and apply skips it instead of resurrecting the row.
	if err := database.DeleteTransaction(loaded.Transactions[0].ID); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if got := countRows(t, database, "suppressed_sync_keys", ""); got != 1 {
		t.Fatalf("suppressions = %d, want the removed key", got)
	}
	second := applyDirectives(t, database, []BankDirective{upsert})
	if second != (SyncApplySummary{}) {
		t.Fatalf("resupply counted: %+v", second)
	}
	if got := countRows(t, database, "transactions", ""); got != 0 {
		t.Fatalf("resupply resurrected %d rows", got)
	}
	// Suppression is per key: an unrelated charge still imports.
	other := bankUpsertDirective(bankSeedTransaction("Bistro", "prime_card", "58.00", false), ProviderSimpleFIN, "bridge-prime", "post2")
	if third := applyDirectives(t, database, []BankDirective{other}); third.SettledInserted != 1 {
		t.Fatalf("unrelated = %+v", third)
	}
}

func TestDeleteOwnerTransactionSuppressesNothing(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	created, err := database.CreateTransaction(types.Transaction{
		Name:            "Manual",
		SourceAccountID: &[]string{"prime_card"}[0],
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785628800,
		TransactionTime: 1785628800,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("create = %v", err)
	}
	if err := database.DeleteTransaction(created.ID); err != nil {
		t.Fatalf("delete = %v", err)
	}
	// Deleting an owner-authored row records no bank-key suppression: a
	// fresh bank delivery with its own key must still import normally.
	imported := applyDirectives(t, database, []BankDirective{bankUpsertDirective(
		bankSeedTransaction("Bank after owner delete", "prime_card", "10", true),
		ProviderSimpleFIN, "bridge-prime", "pend-owner-delete",
	)})
	if imported.PendingInserted != 1 {
		t.Fatalf("bank import after owner delete = %+v", imported)
	}
	model, err := database.LoadModel()
	if err != nil || len(model.Transactions) != 1 || model.Transactions[0].Name != "Bank after owner delete" {
		t.Fatalf("model after owner delete = %+v, err %v", model, err)
	}
}

func TestDeleteVoidSuppressesNothingAndSameKeyStillImports(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedTransaction("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")
	applyDirectives(t, database, []BankDirective{upsert})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Transactions[0].ID
	if first := applyDirectives(t, database, []BankDirective{{Void: id}}); first.PendingDeleted != 1 {
		t.Fatalf("void = %+v", first)
	}
	// Removing a void hold records nothing: its keys already left the
	// feed, and the auth key stays usable for same-key settlement.
	if err := database.DeleteTransaction(id); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if got := countRows(t, database, "suppressed_sync_keys", ""); got != 0 {
		t.Fatalf("void delete suppressed %d keys", got)
	}
	if second := applyDirectives(t, database, []BankDirective{upsert}); second.PendingInserted != 1 {
		t.Fatalf("re-authorized hold skipped: %+v", second)
	}
}

func TestBankConvertSkipsRemovedRow(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	// A conversion racing a removal lands nowhere: the removal stands,
	// and the sync stays green.
	summary, err := database.ApplySync(nil, []BankDirective{{
		Convert: &BankConvert{ID: "missing", Transaction: bankSeedTransaction("C", "prime_card", "10", false)},
	}})
	if err != nil {
		t.Fatalf("convert of removed row errored: %v", err)
	}
	if summary != (SyncApplySummary{}) {
		t.Fatalf("convert of removed row counted: %+v", summary)
	}
}

func TestBankDirectivesRejectInvalidInput(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	for name, directives := range map[string][]BankDirective{
		"empty":   {{}},
		"no keys": {{Upsert: &BankUpsert{Transaction: bankSeedTransaction("C", "prime_card", "10", true)}}},
		"bad key": {{Upsert: &BankUpsert{Transaction: bankSeedTransaction("C", "prime_card", "10", true), Keys: []BankKey{{Provider: "x"}}}}},
		"user source": {{Upsert: &BankUpsert{Transaction: func() types.Transaction {
			p := bankSeedTransaction("C", "prime_card", "10", true)
			p.Source = SourceUser
			return p
		}(), Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1")}}},
		"no account": {{Upsert: &BankUpsert{Transaction: func() types.Transaction {
			p := bankSeedTransaction("C", "prime_card", "10", true)
			p.SourceAccountID = nil
			return p
		}(), Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1")}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := database.ApplySync(nil, directives); err == nil {
				t.Fatalf("%s accepted", name)
			}
		})
	}
}
