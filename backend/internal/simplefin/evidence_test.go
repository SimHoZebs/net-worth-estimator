package simplefin

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestEvidencePreservesFullSourceAndRefreshesKnownSettledKeys(t *testing.T) {
	var transaction Transaction
	if err := json.Unmarshal([]byte(`{"id":"one","description":"`+strings.Repeat("x", 100)+` KLARNA PAY IN 4","amount":"-25","posted":1785628800,"payee":"Klarna","memo":"Installment","extra":{"payment_product":"pay-in-four","secret":"do not retain","category":{"unrecognized":true}}}`), &transaction); err != nil {
		t.Fatal(err)
	}
	set := &AccountSet{Accounts: []Account{{ID: "bank", Currency: "USD", Balance: "100", Transactions: []Transaction{transaction}}}}
	plan, err := Map(set, map[string]string{"bank": "checking"}, time.Unix(1785628800, 0))
	if err != nil || len(plan.Settled) != 1 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	item := plan.Settled[0]
	if len([]rune(item.Name)) != 80 || item.Facts.Description != transaction.Description || item.Facts.Payee != "Klarna" || item.Facts.Metadata["secret"] != "" || item.Facts.Metadata["category"] != "" {
		t.Fatalf("evidence=%+v", item.Facts)
	}
	bank := []store.BankRow{{Posting: types.Posting{ID: "existing", Name: "Owner edited label", Source: store.SourceSimpleFIN}, Keys: []store.BankKey{candidateKey(item)}}}
	directives := Reconcile(nil, plan.Settled, bank, map[string]bool{"checking": true})
	if len(directives) != 1 || directives[0].Observe == nil || directives[0].Upsert != nil || directives[0].Convert != nil {
		t.Fatalf("known settled evidence refresh overwrites financial row: %+v", directives)
	}
}
