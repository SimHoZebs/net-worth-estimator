package integrationedge

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// advSeedBankPending inserts one enabled pending bank row through the real
// sync apply path and returns the store-allocated row ID.
func advSeedBankPending(t *testing.T, scoped store.Store, name, amount string, day int64, key string) string {
	t.Helper()
	source := "checking"
	_, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
		Transaction: types.Transaction{
			Name: name, Source: store.SourceBankSync, SourceAccountID: &source,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      day,
			TransactionTime: day,
			Enabled:         true,
			Pending:         true,
		},
		Keys: []store.BankKey{{Provider: "simplefin", AccountID: "bridge-checking", TransactionID: key}},
	}}})
	if err != nil {
		t.Fatalf("seed bank row: %v", err)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, transaction := range model.Transactions {
		if transaction.Name == name && transaction.Pending {
			return transaction.ID
		}
	}
	t.Fatalf("bank row %q missing after apply", name)
	return ""
}

// advVoid marks one bank row void through the real sync void path.
func advVoid(t *testing.T, scoped store.Store, rowID string) {
	t.Helper()
	summary, err := scoped.ApplySync(nil, []store.BankDirective{{Void: rowID}})
	if err != nil {
		t.Fatalf("void row: %v", err)
	}
	if summary.PendingDeleted != 1 {
		t.Fatalf("void summary = %+v, want the single pending row flipped", summary)
	}
}
