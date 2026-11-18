package sqlite

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func autoClaimNoon(day string) int64 {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		panic(err)
	}
	return stamp.Unix() + 12*3600
}

func autoClaimAmount(value string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": value},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

func autoClaimSchedule(id, account string) types.Schedule {
	source := account
	return types.Schedule{
		ID:              id,
		Name:            "Rent",
		SourceAccountID: &source,
		Amount:          autoClaimAmount("1000"),
		Frequency:       types.FrequencyMonthly,
		StartDate:       "2026-01-01",
		Enabled:         true,
	}
}

func findTransactionByID(t *testing.T, database *sqliteStore, id string) types.Transaction {
	t.Helper()
	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	for _, transaction := range loaded.Transactions {
		if transaction.ID == id {
			return transaction
		}
	}
	t.Fatalf("transaction %s missing in %+v", id, loaded.Transactions)
	return types.Transaction{}
}

// TestAutoClaimSweepBackfillsManualAndBankRows proves the next bank sweep
// claims pre-existing unclaimed rows (owner-settled, bank-settled, and bank
// pending) without duplicating claims on repeat sweeps.
func TestAutoClaimSweepBackfillsManualAndBankRows(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	checking := "checking"

	manual, err := database.CreateTransaction(types.Transaction{
		Name:            "Rent",
		SourceAccountID: &checking,
		Amount:          autoClaimAmount("1000"),
		PostedTime:      autoClaimNoon("2026-02-01"),
		TransactionTime: autoClaimNoon("2026-02-01"),
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("create manual: %v", err)
	}

	settledBank := types.Transaction{
		Name:            "Rent",
		Source:          SourceBankSync,
		SourceAccountID: &checking,
		Amount:          autoClaimAmount("1000"),
		PostedTime:      autoClaimNoon("2026-03-01"),
		TransactionTime: autoClaimNoon("2026-03-01"),
		Enabled:         true,
	}
	if summary, err := database.ApplySync(nil, []BankDirective{{
		Upsert: &BankUpsert{Transaction: settledBank, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post-mar")},
	}}); err != nil || summary.SettledInserted != 1 {
		t.Fatalf("seed settled bank = %+v, err %v", summary, err)
	}

	pendingBank := types.Transaction{
		Name:            "Rent",
		Source:          SourceBankSync,
		SourceAccountID: &checking,
		Amount:          autoClaimAmount("1000"),
		PostedTime:      autoClaimNoon("2026-04-01"),
		TransactionTime: autoClaimNoon("2026-04-01"),
		Enabled:         false,
		Pending:         true,
	}
	if summary, err := database.ApplySync(nil, []BankDirective{{
		Upsert: &BankUpsert{Transaction: pendingBank, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "pend-apr")},
	}}); err != nil || summary.PendingInserted != 1 {
		t.Fatalf("seed pending bank = %+v, err %v", summary, err)
	}

	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load before schedule: %v", err)
	}
	if len(loaded.Transactions) != 3 {
		t.Fatalf("rows before schedule = %d, want 3", len(loaded.Transactions))
	}
	bankIDs := map[int64]string{}
	for _, transaction := range loaded.Transactions {
		if transaction.Claim != nil {
			t.Fatalf("row claimed before schedule exists: %+v", transaction)
		}
		if transaction.ID != manual.ID {
			bankIDs[transaction.TransactionTime] = transaction.ID
		}
	}
	settledID := bankIDs[autoClaimNoon("2026-03-01")]
	pendingID := bankIDs[autoClaimNoon("2026-04-01")]
	if settledID == "" || pendingID == "" {
		t.Fatalf("bank ids missing: %+v", bankIDs)
	}

	if _, err := database.CreateSchedule(autoClaimSchedule("rent", "checking")); err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	// Schedule creation alone does not backfill; the next sweep does.
	for _, transaction := range []types.Transaction{
		findTransactionByID(t, database, manual.ID),
		findTransactionByID(t, database, settledID),
	} {
		if transaction.Claim != nil {
			t.Fatalf("row claimed before sweep: %+v", transaction)
		}
	}

	if _, err := database.ApplySync(nil, nil); err != nil {
		t.Fatalf("backfill sweep: %v", err)
	}

	manualAfter := findTransactionByID(t, database, manual.ID)
	if manualAfter.Claim == nil || manualAfter.Claim.ScheduleID != "rent" || manualAfter.Claim.OccurrenceDate != "2026-02-01" {
		t.Fatalf("manual claim = %+v, want rent on 2026-02-01", manualAfter.Claim)
	}
	settledAfter := findTransactionByID(t, database, settledID)
	if settledAfter.Claim == nil || settledAfter.Claim.ScheduleID != "rent" || settledAfter.Claim.OccurrenceDate != "2026-03-01" {
		t.Fatalf("settled bank claim = %+v, want rent on 2026-03-01", settledAfter.Claim)
	}
	pendingAfter := findTransactionByID(t, database, pendingID)
	if pendingAfter.Claim == nil || pendingAfter.Claim.ScheduleID != "rent" || pendingAfter.Claim.OccurrenceDate != "2026-04-01" {
		t.Fatalf("pending bank claim = %+v, want rent on 2026-04-01", pendingAfter.Claim)
	}
	if pendingAfter.Pending || !pendingAfter.Enabled {
		t.Fatalf("claimed pending not promoted: %+v", pendingAfter)
	}

	// Repeat sweeps never duplicate or move claims.
	if err := database.autoClaimSweep(); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if _, err := database.ApplySync(nil, nil); err != nil {
		t.Fatalf("third sweep: %v", err)
	}
	if got := countRows(t, database, "transaction_claims", ""); got != 3 {
		t.Fatalf("claim rows = %d, want 3 with no duplicates", got)
	}
	for _, want := range []struct {
		id, date string
	}{
		{manual.ID, "2026-02-01"},
		{settledID, "2026-03-01"},
		{pendingID, "2026-04-01"},
	} {
		after := findTransactionByID(t, database, want.id)
		if after.Claim == nil || after.Claim.ScheduleID != "rent" || after.Claim.OccurrenceDate != want.date {
			t.Fatalf("row %s claim moved = %+v, want %s", want.id, after.Claim, want.date)
		}
	}
}

// TestAutoClaimSweepSkipsDisabledAndVoid proves lifecycle gates survive the
// backfill: disabled owner rows and void bank holds never auto-claim.
func TestAutoClaimSweepSkipsDisabledAndVoid(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	checking := "checking"

	disabled, err := database.CreateTransaction(types.Transaction{
		Name:            "Rent",
		SourceAccountID: &checking,
		Amount:          autoClaimAmount("1000"),
		PostedTime:      autoClaimNoon("2026-02-01"),
		TransactionTime: autoClaimNoon("2026-02-01"),
		Enabled:         false,
	})
	if err != nil {
		t.Fatalf("create disabled manual: %v", err)
	}

	pending := types.Transaction{
		Name:            "Rent",
		Source:          SourceBankSync,
		SourceAccountID: &checking,
		Amount:          autoClaimAmount("1000"),
		PostedTime:      autoClaimNoon("2026-05-01"),
		TransactionTime: autoClaimNoon("2026-05-01"),
		Enabled:         false,
		Pending:         true,
	}
	if summary, err := database.ApplySync(nil, []BankDirective{{
		Upsert: &BankUpsert{Transaction: pending, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "pend-may")},
	}}); err != nil || summary.PendingInserted != 1 {
		t.Fatalf("seed pending = %+v, err %v", summary, err)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Transactions) != 2 {
		t.Fatalf("seeded rows = %+v, err %v", loaded, err)
	}
	var voidID string
	for _, transaction := range loaded.Transactions {
		if transaction.ID != disabled.ID {
			voidID = transaction.ID
		}
	}
	if voided, err := database.ApplySync(nil, []BankDirective{{Void: voidID}}); err != nil || voided.PendingDeleted != 1 {
		t.Fatalf("void = %+v, err %v", voided, err)
	}

	if _, err := database.CreateSchedule(autoClaimSchedule("rent", "checking")); err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	if _, err := database.ApplySync(nil, nil); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	disabledAfter := findTransactionByID(t, database, disabled.ID)
	if disabledAfter.Claim != nil {
		t.Fatalf("disabled row claimed: %+v", disabledAfter.Claim)
	}
	voidAfter := findTransactionByID(t, database, voidID)
	if voidAfter.Claim != nil {
		t.Fatalf("void row claimed: %+v", voidAfter.Claim)
	}
	if !voidAfter.Void {
		t.Fatalf("sweep cleared void lifecycle: %+v", voidAfter)
	}
	if got := countRows(t, database, "transaction_claims", ""); got != 0 {
		t.Fatalf("claim rows = %d, want 0", got)
	}
}

// TestAutoClaimSweepUsesPromotionMerchantKey proves a renamed schedule still
// claims through the merchant key persisted with its promotion, while a
// schedule with no promotion keeps matching by name.
func TestAutoClaimSweepUsesPromotionMerchantKey(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "checking")
	checking := "checking"

	promoted := autoClaimSchedule("promoted", "checking")
	promoted.Name = "Renamed Rule"
	if _, err := database.CreateSchedule(promoted); err != nil {
		t.Fatalf("create promoted schedule: %v", err)
	}
	byName := autoClaimSchedule("by-name", "checking")
	byName.Name = "Plain Rent"
	byName.Amount = autoClaimAmount("500")
	if _, err := database.CreateSchedule(byName); err != nil {
		t.Fatalf("create name schedule: %v", err)
	}
	if _, err := database.db.Exec(`INSERT INTO analysis_promotions(pattern_key, rule_id, created_at, merchant_key, user_id) VALUES (?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, pattern_key) DO UPDATE SET rule_id = excluded.rule_id, created_at = excluded.created_at, merchant_key = excluded.merchant_key`, "pattern-promoted", "promoted", 0, "rent"); err != nil {
		t.Fatalf("record promotion: %v", err)
	}

	bankRow := func(name, amount, day string) types.Transaction {
		return types.Transaction{
			Name:            name,
			Source:          SourceBankSync,
			SourceAccountID: &checking,
			Amount:          autoClaimAmount(amount),
			PostedTime:      autoClaimNoon(day),
			TransactionTime: autoClaimNoon(day),
			Enabled:         true,
		}
	}
	renamedDescriptor := bankRow("RENT PAYMENT", "1000", "2026-02-02")
	if summary, err := database.ApplySync(nil, []BankDirective{{
		Upsert: &BankUpsert{Transaction: renamedDescriptor, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "renamed-desc")},
	}}); err != nil || summary.SettledInserted != 1 {
		t.Fatalf("seed renamed descriptor = %+v, err %v", summary, err)
	}
	nameDescriptor := bankRow("Plain Rent", "500", "2026-02-03")
	if summary, err := database.ApplySync(nil, []BankDirective{{
		Upsert: &BankUpsert{Transaction: nameDescriptor, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "name-desc")},
	}}); err != nil || summary.SettledInserted != 1 {
		t.Fatalf("seed name descriptor = %+v, err %v", summary, err)
	}

	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var renamedID, nameID string
	for _, transaction := range loaded.Transactions {
		switch transaction.Name {
		case "RENT PAYMENT":
			renamedID = transaction.ID
		case "Plain Rent":
			nameID = transaction.ID
		}
	}
	if renamedID == "" || nameID == "" {
		t.Fatalf("bank ids missing: renamed=%q name=%q", renamedID, nameID)
	}

	if _, err := database.ApplySync(nil, nil); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	renamedAfter := findTransactionByID(t, database, renamedID)
	if renamedAfter.Claim == nil || renamedAfter.Claim.ScheduleID != "promoted" || renamedAfter.Claim.OccurrenceDate != "2026-02-01" {
		t.Fatalf("renamed descriptor claim = %+v, want promoted on 2026-02-01", renamedAfter.Claim)
	}
	nameAfter := findTransactionByID(t, database, nameID)
	if nameAfter.Claim == nil || nameAfter.Claim.ScheduleID != "by-name" || nameAfter.Claim.OccurrenceDate != "2026-02-01" {
		t.Fatalf("name descriptor claim = %+v, want by-name on 2026-02-01", nameAfter.Claim)
	}
}
