package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Composite intent writes: the API translates one frontend intent into one
// store call that persists every affected row in a single transaction.

func TestAccountWithBalanceWritesCheckpointAtomically(t *testing.T) {
	store := openTestStore(t)
	balance := 2500.0
	created, err := store.CreateAccountWithBalance(
		types.Account{ID: "checking", Name: "Checking", Enabled: true},
		&balance, 1772409599,
	)
	if err != nil {
		t.Fatalf("create with balance: %v", err)
	}
	loaded, err := store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Accounts) != 1 || len(loaded.Checkpoints) != 1 {
		t.Fatalf("stored accounts/checkpoints = %+v", loaded)
	}
	got := loaded.Checkpoints[0]
	if got.AccountID != "checking" || got.ObservedAt != 1772409599 || got.Balance != 2500 || got.Source != SourceUser {
		t.Fatalf("checkpoint = %+v", got)
	}

	moved := 3200.0
	if _, err := store.UpdateAccountWithBalance(
		types.Account{ID: "checking", Name: "Renamed", Enabled: true},
		&moved, 1775001599,
	); err != nil {
		t.Fatalf("update with balance: %v", err)
	}
	loaded, err = store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Accounts[0].Name != "Renamed" {
		t.Fatalf("account = %+v", loaded.Accounts[0])
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v", loaded.Checkpoints)
	}

	// Nil balance leaves balance history untouched.
	if _, err := store.UpdateAccountWithBalance(
		types.Account{ID: "checking", Name: "Renamed again", Enabled: true},
		nil, 0,
	); err != nil {
		t.Fatalf("update without balance: %v", err)
	}
	loaded, err = store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("nil balance must not write checkpoints: %+v", loaded.Checkpoints)
	}

	// A missing account writes nothing, including no checkpoint.
	ghost := 1.0
	if _, err := store.UpdateAccountWithBalance(
		types.Account{ID: "ghost", Name: "Ghost"}, &ghost, 1775001599,
	); !IsNotFound(err) {
		t.Fatalf("update missing err = %v, want not-found", err)
	}
	loaded, err = store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("failed update must not write checkpoints: %+v", loaded.Checkpoints)
	}
	_ = created
}

func TestTransactionEditLeavesStandalonePurchasesUntouched(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	transaction := testTransactionFixture("01900000-0000-7000-8000-000000000002")
	account := "checking"
	if _, err := store.CreatePlannedPurchase(types.PlannedPurchase{ID: "01900000-0000-7000-8000-000000000003", Name: "Desk", FundingAccountID: &account, Cost: 100, EarliestDate: "2026-02-01", Priority: 2, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTransaction(transaction); err != nil {
		t.Fatalf("seed transaction: %v", err)
	}
	renamed := testTransactionFixture("01900000-0000-7000-8000-000000000002")
	renamed.Name = "Renamed"
	_, err := store.UpdateTransaction(renamed)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	loaded, err := store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.PlannedPurchases) != 1 || loaded.PlannedPurchases[0].Priority != 2 {
		t.Fatalf("planned purchases = %+v", loaded.PlannedPurchases)
	}
}

func TestUpdateEvaluationMovesType(t *testing.T) {
	store := openTestStore(t)
	item, err := store.CreateEvaluation(EvaluationUpdate{
		Type: "netWorthThreshold", InstanceID: "goal", Name: "Goal",
		Enabled: true, Config: map[string]any{"target": 1000},
	})
	if err != nil {
		t.Fatalf("seed evaluation: %v", err)
	}
	if _, err := store.SetPinnedEvaluations([]string{"goal"}); err != nil {
		t.Fatalf("seed pin: %v", err)
	}
	moved, err := store.UpdateEvaluation(EvaluationUpdate{
		Type: "accountBalance", InstanceID: item.InstanceID, Name: "Goal",
		Enabled: true, Config: map[string]any{"target": 500},
	})
	if err != nil {
		t.Fatalf("move evaluation: %v", err)
	}
	if moved.Type != "accountBalance" {
		t.Fatalf("type = %q, want accountBalance", moved.Type)
	}
	loaded, err := store.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Evaluations.NetWorthThreshold) != 0 {
		t.Fatalf("old table = %+v, want empty", loaded.Evaluations.NetWorthThreshold)
	}
	if len(loaded.Evaluations.AccountBalance) != 1 || loaded.Evaluations.AccountBalance[0].InstanceID != "goal" {
		t.Fatalf("new table = %+v", loaded.Evaluations.AccountBalance)
	}
	pins, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("pins: %v", err)
	}
	if len(pins) != 1 || pins[0] != "goal" {
		t.Fatalf("pins = %+v, want the pin to survive the move", pins)
	}
	if _, err := store.UpdateEvaluation(EvaluationUpdate{Type: "nope", InstanceID: "goal", Name: "Goal", Enabled: true}); err == nil {
		t.Fatal("unknown target type must fail")
	}
}
