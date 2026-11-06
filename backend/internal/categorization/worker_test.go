package categorization_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func newCategoryStore(t *testing.T) (store.Store, *sqlite.Database) {
	t.Helper()
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "categories.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	scoped, err := database.EnsureUser("category-user", "https://issuer.test", "category-subject")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return scoped, database
}

func seedCharge(t *testing.T, scoped store.Store, name, transactionID, bankCategory string) string {
	t.Helper()
	account := "checking"
	facts := types.TransactionFacts{Description: name, Amount: "-42.00", Currency: "USD", PostedTime: 1785628800}
	if bankCategory != "" {
		facts.Metadata = map[string]string{"category": bankCategory}
	}
	summary, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
		Transaction: types.Transaction{
			Name:            name,
			Source:          store.SourceBankSync,
			SourceAccountID: &account,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "42.00"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      1785628800,
			TransactionTime: 1785628800,
			Enabled:         true,
		},
		Keys:  []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge", TransactionID: transactionID}},
		Facts: &facts,
	}}})
	if err != nil || summary.SettledInserted != 1 {
		t.Fatalf("seed=%+v err=%v", summary, err)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	return rows[0].Transaction.ID
}

func categoryOf(t *testing.T, scoped store.Store, transactionID string) types.TransactionCategory {
	t.Helper()
	items, err := scoped.LoadTransactionCategories([]string{transactionID})
	if err != nil {
		t.Fatal(err)
	}
	return items[transactionID]
}

func TestWorkerFillsUncategorizedBankRows(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "WHOLE FOODS MARKET", "food", "")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := categoryOf(t, scoped, transactionID)
	if got.Category != types.CategoryFoodAndDrink || got.Source != types.CategorySourceInferred || got.Producer != "keyword-v1" {
		t.Fatalf("category=%+v", got)
	}
	// A restart reruns the same scan. The settled assignment stays stable.
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := categoryOf(t, scoped, transactionID); again != got {
		t.Fatalf("repeat changed category: %+v", again)
	}
	// The owner wins over a later classifier pass.
	userCategory := types.CategoryMedical
	if _, err := scoped.SetUserTransactionCategory(transactionID, &userCategory); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := categoryOf(t, scoped, transactionID); again.Category != types.CategoryMedical || again.Source != types.CategorySourceUser {
		t.Fatalf("classifier replaced user: %+v", again)
	}
}

func TestWorkerLeavesSupportedBankValuesAndSkipsClassifiedRows(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "WHOLE FOODS MARKET", "food", "GENERAL_MERCHANDISE")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := categoryOf(t, scoped, transactionID)
	if got.Category != types.CategoryGeneralMerchandise || got.Source != types.CategorySourceBank {
		t.Fatalf("category=%+v", got)
	}
}

func TestWorkerLeavesUnknownRowsUncategorized(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "LOCAL SHOP", "shop", "")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := categoryOf(t, scoped, transactionID); got.Category != "" {
		t.Fatalf("unknown row gained a category: %+v", got)
	}
}
