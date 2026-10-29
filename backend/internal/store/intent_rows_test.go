package store

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
		&balance, "2026-03-01",
	)
	if err != nil {
		t.Fatalf("create with balance: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Accounts) != 1 || len(loaded.Checkpoints) != 1 {
		t.Fatalf("stored accounts/checkpoints = %+v", loaded)
	}
	got := loaded.Checkpoints[0]
	if got.AccountID != "checking" || string(got.Date) != "2026-03-01" || got.Balance != 2500 || got.Source != SourceUser {
		t.Fatalf("checkpoint = %+v", got)
	}

	moved := 3200.0
	if _, err := store.UpdateAccountWithBalance(
		types.Account{ID: "checking", Name: "Renamed", Enabled: true},
		&moved, "2026-04-01",
	); err != nil {
		t.Fatalf("update with balance: %v", err)
	}
	loaded, err = store.LoadDocument()
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
		nil, "",
	); err != nil {
		t.Fatalf("update without balance: %v", err)
	}
	loaded, err = store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("nil balance must not write checkpoints: %+v", loaded.Checkpoints)
	}

	// A missing account writes nothing, including no checkpoint.
	ghost := 1.0
	if _, err := store.UpdateAccountWithBalance(
		types.Account{ID: "ghost", Name: "Ghost"}, &ghost, "2026-05-01",
	); !IsNotFound(err) {
		t.Fatalf("update missing err = %v, want not-found", err)
	}
	loaded, err = store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("failed update must not write checkpoints: %+v", loaded.Checkpoints)
	}
	_ = created
}

func TestConvertPostingToRuleKeepsIdentity(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	posting := testPostingFixture("01900000-0000-7000-8000-000000000001")
	posting.Purchase = &types.PurchasePolicy{Priority: 3}
	if _, err := store.CreatePosting(posting); err != nil {
		t.Fatalf("seed posting: %v", err)
	}
	rule, err := store.ConvertPostingToRule("01900000-0000-7000-8000-000000000001", testRuleFixture("ignored"))
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if rule.ID != "01900000-0000-7000-8000-000000000001" {
		t.Fatalf("converted rule id = %q, want the posting id", rule.ID)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Postings) != 0 {
		t.Fatalf("postings = %+v, want none", loaded.Postings)
	}
	if len(loaded.RecurrenceRules) != 1 || loaded.RecurrenceRules[0].ID != "01900000-0000-7000-8000-000000000001" {
		t.Fatalf("rules = %+v", loaded.RecurrenceRules)
	}
	if _, err := store.ConvertPostingToRule("ghost", testRuleFixture("ghost")); !IsNotFound(err) {
		t.Fatalf("convert missing err = %v, want not-found", err)
	}
}

func TestConvertRuleToPostingAppendsOwnerRow(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := store.CreateRule(testRuleFixture("once-day")); err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	posting, err := store.ConvertRuleToPosting("once-day", testPostingFixture("ignored"))
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if posting.ID != "once-day" || posting.Source != SourceUser || posting.Pending {
		t.Fatalf("converted posting = %+v", posting)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.RecurrenceRules) != 0 {
		t.Fatalf("rules = %+v, want none", loaded.RecurrenceRules)
	}
	if len(loaded.Postings) != 1 || loaded.Postings[0].ID != "once-day" {
		t.Fatalf("postings = %+v", loaded.Postings)
	}
	if _, err := store.ConvertRuleToPosting("ghost", testPostingFixture("ghost")); !IsNotFound(err) {
		t.Fatalf("convert missing err = %v, want not-found", err)
	}
}

func TestUpdatePostingKeepsStoredPurchasePolicy(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	posting := testPostingFixture("01900000-0000-7000-8000-000000000002")
	posting.Purchase = &types.PurchasePolicy{Priority: 2}
	if _, err := store.CreatePosting(posting); err != nil {
		t.Fatalf("seed posting: %v", err)
	}
	renamed := testPostingFixture("01900000-0000-7000-8000-000000000002")
	renamed.Name = "Renamed"
	renamed.Purchase = nil
	updated, err := store.UpdatePosting(renamed)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Purchase == nil || updated.Purchase.Priority != 2 {
		t.Fatalf("purchase policy = %+v, want priority 2 kept", updated.Purchase)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Postings[0].Purchase == nil || loaded.Postings[0].Purchase.Priority != 2 {
		t.Fatalf("stored policy = %+v", loaded.Postings[0].Purchase)
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
	loaded, err := store.LoadDocument()
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
