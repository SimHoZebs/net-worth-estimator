package sqlite

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedSourceFacts(t *testing.T, scoped store.Store, accountID, bankID, payee, merchant string) string {
	t.Helper()
	if _, err := scoped.CreateAccount(types.Account{ID: accountID, Name: accountID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	facts := types.TransactionFacts{
		Description: "Provider descriptor",
		Payee:       payee,
		Metadata:    map[string]string{"merchant_name": merchant},
	}
	applyDirectives(t, scoped, []BankDirective{categoryUpsertDirective(
		bankSeedTransaction("Editable name", accountID, "12.00", false),
		ProviderSimpleFIN, "bridge", bankID, facts,
	)})
	model, err := scoped.LoadModel()
	if err != nil || len(model.Transactions) != 1 {
		t.Fatalf("model=%+v err=%v", model, err)
	}
	return model.Transactions[0].ID
}

func TestLoadTransactionSourceFactsScopesDeduplicatesAndBatches(t *testing.T) {
	database, err := SetupDatabase(filepath.Join(t.TempDir(), "facts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	alice, err := database.EnsureUser("facts-alice", "https://issuer.test", "facts-alice")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := database.EnsureUser("facts-bob", "https://issuer.test", "facts-bob")
	if err != nil {
		t.Fatal(err)
	}
	aliceID := seedSourceFacts(t, alice, "checking", "alice-charge", "PayPal", "Local Shop")
	bobID := seedSourceFacts(t, bob, "checking", "bob-charge", "Venmo", "Private Merchant")

	empty, err := alice.LoadTransactionSourceFacts(nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty facts=%v err=%v", empty, err)
	}
	facts, err := alice.LoadTransactionSourceFacts([]string{aliceID, bobID, aliceID, ""})
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[aliceID].Payee != "PayPal" || facts[aliceID].Metadata["merchant_name"] != "Local Shop" {
		t.Fatalf("scoped facts=%+v", facts)
	}
	if _, ok := facts[bobID]; ok {
		t.Fatal("another user's transaction facts crossed the scope boundary")
	}

	ids := make([]string, transactionFactsChunkSize+1)
	for index := range ids {
		ids[index] = fmt.Sprintf("missing-%d", index)
	}
	ids[len(ids)-1] = aliceID
	batched, err := alice.LoadTransactionSourceFacts(ids)
	if err != nil {
		t.Fatalf("batched facts: %v", err)
	}
	want := types.TransactionFacts{
		Description: "Provider descriptor",
		Payee:       "PayPal",
		Metadata:    map[string]string{"merchant_name": "Local Shop"},
	}
	if !reflect.DeepEqual(batched[aliceID], want) {
		t.Fatalf("batched fact=%+v want=%+v", batched[aliceID], want)
	}
}
