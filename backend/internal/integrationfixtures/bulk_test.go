package integrationfixtures

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestParseBulkSpec(t *testing.T) {
	empty, err := ParseBulkSpec("")
	if err != nil {
		t.Fatal(err)
	}
	if empty.Accounts != 0 {
		t.Fatalf("empty accounts = %d", empty.Accounts)
	}
	spec, err := ParseBulkSpec("20x200")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Accounts != 20 || spec.TransactionsPerAccount != 200 || spec.Seed != BulkDefaultSeed {
		t.Fatalf("spec = %+v", spec)
	}
	seeded, err := ParseBulkSpec("3x5:42")
	if err != nil {
		t.Fatal(err)
	}
	if seeded.Seed != 42 {
		t.Fatalf("seed = %d", seeded.Seed)
	}
	for _, raw := range []string{"20", "0x5", "101x1", "1x1001", "100x1000", "3x5:abc"} {
		if _, err := ParseBulkSpec(raw); err == nil {
			t.Fatalf("bulk %q must fail", raw)
		}
	}
}

func TestBulkModelDeterministic(t *testing.T) {
	spec, err := ParseBulkSpec("8x2:42")
	if err != nil {
		t.Fatal(err)
	}
	first, second := BuildBulkModel(spec), BuildBulkModel(spec)
	if !reflect.DeepEqual(first, second) {
		t.Fatal("same spec built different models")
	}
	if len(first.Accounts) != 8 || len(first.Transactions) != 16 || len(first.Schedules) != 2 {
		t.Fatalf("model counts = %d/%d/%d", len(first.Accounts), len(first.Transactions), len(first.Schedules))
	}
	long := false
	for _, account := range first.Accounts {
		if strings.Contains(account.Name, strings.Repeat("é", 40)) {
			long = true
		}
	}
	if !long {
		t.Fatal("eight accounts must include the overlong name branch")
	}
	other, err := ParseBulkSpec("8x2:43")
	if err != nil {
		t.Fatal(err)
	}
	third := BuildBulkModel(other)
	if reflect.DeepEqual(first.Accounts, third.Accounts) {
		t.Fatal("distinct seeds must build distinct account IDs")
	}
}

func TestBulkInjectClearKeepsRealRows(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "bulk.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	user, err := db.EnsureGroupUser("https://issuer.test", "bulk-user")
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.EnsureUser(user, "https://issuer.test", "bulk-user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	source := "checking"
	real, err := scoped.CreateTransaction(types.Transaction{
		Name: "Real groceries", SourceAccountID: &source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "19.99"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1781524800,
		TransactionTime: 1781524800,
		Enabled:         true,
	})
	if err != nil {
		t.Fatal(err)
	}
	spec, err := ParseBulkSpec("3x5:42")
	if err != nil {
		t.Fatal(err)
	}
	injected, err := InjectBulk(scoped, spec)
	if err != nil {
		t.Fatal(err)
	}
	if injected.Accounts != 3 || injected.Transactions != 15 || injected.Rules != 1 {
		t.Fatalf("injected = %+v", injected)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Accounts) != 4 {
		t.Fatalf("accounts = %d, want 4", len(model.Accounts))
	}
	for _, account := range model.Accounts {
		if !strings.HasPrefix(account.ID, SeedPrefix) {
			continue
		}
		if account.Name == "" {
			t.Fatalf("seed account %q needs a name", account.ID)
		}
	}
	cleared, err := ClearSeed(scoped)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.Accounts != 3 || cleared.Transactions != 15 || cleared.Rules != 1 {
		t.Fatalf("cleared = %+v", cleared)
	}
	after, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Accounts) != 1 || after.Accounts[0].ID != "checking" {
		t.Fatalf("accounts after clear = %+v", after.Accounts)
	}
	if len(after.Transactions) != 1 || after.Transactions[0].ID != real.ID {
		t.Fatalf("transactions after clear = %d", len(after.Transactions))
	}
	again, err := ClearSeed(scoped)
	if err != nil {
		t.Fatal(err)
	}
	if again.Accounts != 0 || again.Transactions != 0 {
		t.Fatalf("second clear = %+v, want empty", again)
	}
}
