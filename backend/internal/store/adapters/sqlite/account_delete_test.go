package sqlite

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func deletionAmount(expression string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": expression},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

func TestDeleteAccountCascadesDependentHistory(t *testing.T) {
	s := openSQLiteStore(t)
	for _, id := range []string{"delete-me", "source", "unrelated"} {
		seedAccount(t, s, id)
	}
	if _, err := s.SaveCheckpoint(types.Checkpoint{AccountID: "delete-me", Balance: 321, ObservedAt: 1769903999}); err != nil {
		t.Fatal(err)
	}
	const (
		incomingID = "01900000-0000-7000-8000-0000000000d1"
		outgoingID = "01900000-0000-7000-8000-0000000000d2"
		keepID     = "01900000-0000-7000-8000-0000000000d3"
		ruleID     = "01900000-0000-7000-8000-0000000000d4"
		purchaseID = "01900000-0000-7000-8000-0000000000d5"
		evalID     = "01900000-0000-7000-8000-0000000000d6"
	)
	for _, transaction := range []types.Transaction{
		{ID: incomingID, Name: "Incoming", SourceAccountID: supersedeStringPtr("source"), Destinations: []string{"delete-me"}, Amount: deletionAmount("21"), PostedTime: 1769903999, TransactionTime: 1769903999, Enabled: true},
		{ID: outgoingID, Name: "Outgoing", SourceAccountID: supersedeStringPtr("delete-me"), Destinations: []string{"unrelated"}, Amount: deletionAmount("10"), PostedTime: 1769903999, TransactionTime: 1769903999, Enabled: true},
		{ID: keepID, Name: "Keep", SourceAccountID: supersedeStringPtr("source"), Destinations: []string{"unrelated"}, Amount: deletionAmount("5"), PostedTime: 1769903999, TransactionTime: 1769903999, Enabled: true},
	} {
		if _, err := s.CreateTransaction(transaction); err != nil {
			t.Fatalf("create transaction %s: %v", transaction.ID, err)
		}
	}
	if _, err := s.CreateSchedule(types.Schedule{
		ID: ruleID, Name: "Dependent schedule", SourceAccountID: supersedeStringPtr("delete-me"), Destinations: []string{"unrelated"},
		Amount: deletionAmount("10"), Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate: "2026-02-01", Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePlannedPurchase(types.PlannedPurchase{
		ID: purchaseID, Name: "Dependent purchase", FundingAccountID: supersedeStringPtr("delete-me"),
		Cost: 100, EarliestDate: "2026-03-01", Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePaymentTerms(types.PaymentTerms{AccountID: "delete-me", MinimumFixed: 10, DueDay: 15}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateEvaluation(store.EvaluationUpdate{
		Type: types.EvaluationTypeAccountBalance, InstanceID: evalID, Name: "Dependent goal", Enabled: true,
		Config: map[string]any{"accountId": "delete-me", "target": 1000},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSafeSpendingSettings(types.SafeSpendingSettings{
		CycleStartDay: 3, PaydayDay: 27, SavingsTarget: 225,
		AccountIDs: []string{"delete-me", "unrelated"}, SpendingAccountIDs: []string{"delete-me"},
		TransactionIDs: []string{incomingID, keepID}, IncomeScheduleIDs: []string{ruleID},
	}); err != nil {
		t.Fatal(err)
	}
	statementID := types.DerivedStatementID("delete-me", "2026-01-31")
	allocation, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statementID, TransactionID: incomingID, Amount: 21, State: "confirmed", Evidence: "test", Actor: "owner",
	})
	if err != nil {
		t.Fatal(err)
	}
	beforeState, err := s.GetProjectionState()
	if err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteAccount("delete-me"); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Accounts) != 2 || model.Accounts[0].ID != "source" || model.Accounts[1].ID != "unrelated" {
		t.Fatalf("accounts after cascade = %+v", model.Accounts)
	}
	if len(model.Checkpoints) != 0 {
		t.Fatalf("checkpoints after cascade = %+v", model.Checkpoints)
	}
	if len(model.Transactions) != 1 || model.Transactions[0].ID != keepID {
		t.Fatalf("transactions after cascade = %+v", model.Transactions)
	}
	if len(model.Schedules) != 0 || len(model.PlannedPurchases) != 0 || len(model.PaymentTerms) != 0 {
		t.Fatalf("dependent rows survived: schedules=%+v purchases=%+v terms=%+v", model.Schedules, model.PlannedPurchases, model.PaymentTerms)
	}
	if len(model.Evaluations.AccountBalance) != 0 {
		t.Fatalf("dependent evaluation survived: %+v", model.Evaluations.AccountBalance)
	}
	settings, err := s.GetSafeSpendingSettings()
	if err != nil || settings == nil {
		t.Fatalf("settings = %+v, %v", settings, err)
	}
	if len(settings.AccountIDs) != 1 || settings.AccountIDs[0] != "unrelated" ||
		len(settings.SpendingAccountIDs) != 0 || len(settings.TransactionIDs) != 1 || settings.TransactionIDs[0] != keepID ||
		len(settings.IncomeScheduleIDs) != 0 || settings.CycleStartDay != 3 || settings.PaydayDay != 27 || settings.SavingsTarget != 225 {
		t.Fatalf("settings after cascade = %+v", settings)
	}
	var allocations, events int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM statement_allocations WHERE user_id = :user_id`).Scan(&allocations); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM statement_allocation_events WHERE allocation_id = ? AND user_id = :user_id`, allocation.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if allocations != 0 || events != 0 {
		t.Fatalf("statement allocation survived: allocations=%d events=%d", allocations, events)
	}
	afterState, err := s.GetProjectionState()
	if err != nil {
		t.Fatal(err)
	}
	if afterState.Revision != beforeState.Revision+1 || afterState.PublishedRevision != 0 {
		t.Fatalf("projection state was not invalidated: before=%+v after=%+v", beforeState, afterState)
	}
}

func TestDeleteAccountPreservesNilSafeSpendingSelection(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "manual")
	if err := s.SetSafeSpendingSettings(types.SafeSpendingSettings{AccountIDs: nil, SavingsTarget: 42}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount("manual"); err != nil {
		t.Fatal(err)
	}
	settings, err := s.GetSafeSpendingSettings()
	if err != nil || settings == nil {
		t.Fatalf("settings = %+v, %v", settings, err)
	}
	if settings.AccountIDs != nil || settings.SavingsTarget != 42 {
		t.Fatalf("nil selection or unrelated setting changed: %+v", settings)
	}
}

func TestDeleteAccountRejectsSyncedEvidence(t *testing.T) {
	t.Run("link without bank rows", func(t *testing.T) {
		s := openSQLiteStore(t)
		seedAccount(t, s, "manual")
		if _, err := s.SaveAccountLink(AccountLink{BridgeAccountID: "bridge", ModelAccountID: "manual", Origin: LinkOriginManual}); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteAccount("manual"); !errors.Is(err, store.ErrAccountSynced) {
			t.Fatalf("delete linked account = %v, want ErrAccountSynced", err)
		}
	})
	t.Run("bank checkpoint", func(t *testing.T) {
		s := openSQLiteStore(t)
		seedAccount(t, s, "manual")
		execSyncSetup(t, s, []string{
			`INSERT INTO checkpoints (id, position, model_account_id, balance, source, provider, observed_at, user_id) VALUES (9001, 9001, 'manual', 10, 'banksync', 'simplefin', 1769903999, :user_id)`,
		})
		if err := s.DeleteAccount("manual"); !errors.Is(err, store.ErrAccountSynced) {
			t.Fatalf("delete bank checkpoint account = %v, want ErrAccountSynced", err)
		}
	})
	for _, destinationOnly := range []bool{false, true} {
		name := "bank transaction source"
		if destinationOnly {
			name = "bank transaction destination"
		}
		t.Run(name, func(t *testing.T) {
			s := openSQLiteStore(t)
			seedAccount(t, s, "manual")
			seedAccount(t, s, "other")
			source := "manual"
			destinations := "'null'"
			if destinationOnly {
				source = "other"
				destinations = `'["manual"]'`
			}
			execSyncSetup(t, s, []string{
				`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id) VALUES ('bank-tx', 'Bank', '` + source + `', ` + destinations + `, '` + syncTestAmountJSON + `', 1769903999, 1769903999, 'banksync', 0, 0, :user_id)`,
				`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id) VALUES ('bank-tx', 0, 1, 0, :user_id)`,
			})
			if err := s.DeleteAccount("manual"); !errors.Is(err, store.ErrAccountSynced) {
				t.Fatalf("delete bank transaction account = %v, want ErrAccountSynced", err)
			}
		})
	}
}

func TestDeleteAccountCascadesAmountDependencies(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "delete-me")
	seedAccount(t, s, "source")
	seedAccount(t, s, "unrelated")
	dependent := types.Transaction{
		ID: "01900000-0000-7000-8000-0000000000f1", Name: "Balance-dependent",
		SourceAccountID: supersedeStringPtr("source"), Destinations: []string{"unrelated"},
		Amount: types.TransactionAmountResolution{
			Resolver: "expression", Config: map[string]any{"expression": "balance"},
			Inputs: map[string]types.AmountInputBinding{
				"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "delete-me"}},
			},
		},
		PostedTime: 1769903999, TransactionTime: 1769903999, Enabled: true,
	}
	if _, err := s.CreateTransaction(dependent); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount("delete-me"); err != nil {
		t.Fatal(err)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Transactions) != 0 {
		t.Fatalf("amount-dependent transaction survived: %+v", model.Transactions)
	}
}

func TestDeleteAccountRejectsSyncedAmountDependency(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "delete-me")
	seedAccount(t, s, "source")
	amountJSON := `{"resolver":"expression","config":{"expression":"balance"},"inputs":{"balance":{"source":"provider","provider":"account-balance","arguments":{"id":"delete-me"}}}}`
	execSyncSetup(t, s, []string{
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id) VALUES ('bank-dependent', 'Bank balance', 'source', 'null', '` + amountJSON + `', 1769903999, 1769903999, 'banksync', 0, 0, :user_id)`,
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id) VALUES ('bank-dependent', 0, 1, 0, :user_id)`,
	})
	if err := s.DeleteAccount("delete-me"); !errors.Is(err, store.ErrAccountSynced) {
		t.Fatalf("delete account with bank amount dependency = %v, want ErrAccountSynced", err)
	}
	model, err := s.LoadModel()
	if err != nil || model == nil || len(model.Accounts) != 2 || len(model.Transactions) != 1 {
		t.Fatalf("refused cascade changed rows: %+v, %v", model, err)
	}
}

func TestDeleteAccountRejectsLoanWithSyncedComponent(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "funding")
	bundle, err := domain.BuildLoan(
		"loan-principal", "loan-interest", "01900000-0000-7000-8000-0000000000f2", "01900000-0000-7000-8000-0000000000f3",
		types.LoanTerms{
			Name: "Loan", Principal: 1000, AccruedInterest: 20, ObservedAt: 1769903999, RecordBalances: true,
			AnnualRate: 0.03, InterestFrequency: types.FrequencyMonthly, InterestStartDate: "2026-02-01",
			Payment: 50, PaymentFrequency: types.FrequencyMonthly, PaymentStartDate: "2026-02-01", FundingAccountID: "funding", Enabled: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(bundle, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveAccountLink(AccountLink{BridgeAccountID: "bridge-interest", ModelAccountID: "loan-interest", BridgeName: "Interest"}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount("loan-principal"); !errors.Is(err, store.ErrAccountSynced) {
		t.Fatalf("delete loan with synced component = %v, want ErrAccountSynced", err)
	}
	model, err := s.LoadModel()
	if err != nil || model == nil || len(model.Accounts) != 3 {
		t.Fatalf("refused loan cascade changed accounts: %+v, %v", model, err)
	}
}

func TestDeleteAccountRemovesWholeGroupedLoan(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "funding")
	bundle, err := domain.BuildLoan(
		"loan-principal", "loan-interest", "01900000-0000-7000-8000-0000000000e1", "01900000-0000-7000-8000-0000000000e2",
		types.LoanTerms{
			Name: "Loan", Principal: 1000, AccruedInterest: 20, ObservedAt: 1769903999, RecordBalances: true,
			AnnualRate: 0.03, InterestFrequency: types.FrequencyMonthly, InterestStartDate: "2026-02-01",
			Payment: 50, PaymentFrequency: types.FrequencyMonthly, PaymentStartDate: "2026-02-01", FundingAccountID: "funding", Enabled: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(bundle, true); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount("loan-interest"); err != nil {
		t.Fatalf("delete loan component: %v", err)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Accounts) != 1 || model.Accounts[0].ID != "funding" || len(model.Schedules) != 0 || len(model.Checkpoints) != 0 {
		t.Fatalf("loan cascade incomplete: accounts=%+v schedules=%+v checkpoints=%+v", model.Accounts, model.Schedules, model.Checkpoints)
	}
}
