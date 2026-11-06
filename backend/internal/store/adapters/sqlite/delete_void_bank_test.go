package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func seedVoidBankRow(t *testing.T, database store.Store, name, account, amount, key string) string {
	t.Helper()
	seed := bankSeedTransaction(name, account, amount, true)
	summary := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Transaction: seed, Keys: bankKeys(ProviderSimpleFIN, "bridge-"+account, key)},
	}})
	if summary.PendingInserted != 1 {
		t.Fatalf("seed pending = %+v", summary)
	}
	rows, err := database.LoadBankTransactions()
	if err != nil {
		t.Fatalf("load bank transactions: %v", err)
	}
	var id string
	for _, row := range rows {
		for _, bankKey := range row.Keys {
			if bankKey.TransactionID == key {
				id = row.Transaction.ID
			}
		}
	}
	if id == "" {
		t.Fatalf("seeded pending row %s missing", key)
	}
	voided := applyDirectives(t, database, []BankDirective{{Void: id}})
	if voided.PendingDeleted != 1 {
		t.Fatalf("void = %+v", voided)
	}
	return id
}

func TestDeleteTransactionRemovesPhantomVoid(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	voidID := seedVoidBankRow(t, database, "Bistro", "prime_card", "50.00", "auth-a")
	settled := bankSeedTransaction("Bistro", "prime_card", "58.00", false)
	if inserted := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Transaction: settled, Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "post-a")},
	}}); inserted.SettledInserted != 1 {
		t.Fatalf("seed settled = %+v", inserted)
	}
	if err := database.DeleteTransaction(voidID); err != nil {
		t.Fatalf("delete void = %v", err)
	}
	after, err := database.LoadBankTransactions()
	if err != nil || len(after) != 1 {
		t.Fatalf("bank rows = %+v, err %v", after, err)
	}
	if after[0].Transaction.Void || !after[0].Transaction.Enabled {
		t.Fatalf("survivor = %+v, want the enabled settled sibling", after[0].Transaction)
	}
	if after[0].Transaction.Amount.Config["expression"] != "58.00" {
		t.Fatalf("survivor amount = %+v, want the posted total", after[0].Transaction.Amount)
	}
}

func TestDeleteTransactionAllowsSettledBankRows(t *testing.T) {
	// Settled bank rows were already owner-deletable through the store;
	// the UI keeps the delete control hidden for them because a deleted
	// settled row is re-imported by the next sync.
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	settled := bankSeedTransaction("Bistro", "prime_card", "58.00", false)
	inserted := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Transaction: settled, Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "post-a")},
	}})
	if inserted.SettledInserted != 1 {
		t.Fatalf("seed settled = %+v", inserted)
	}
	rows, err := database.LoadBankTransactions()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank rows = %+v, err %v", rows, err)
	}
	if err := database.DeleteTransaction(rows[0].Transaction.ID); err != nil {
		t.Fatalf("delete settled bank row = %v", err)
	}
}
