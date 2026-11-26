package simplefin

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestTransactionFactsPersistPendingEvidence(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
		want bool
	}{
		{name: "explicit pending with positive posted", raw: `{"posted":1785628800,"pending":true}`, want: true},
		{name: "explicit pending with zero posted", raw: `{"posted":0,"pending":true}`, want: true},
		{name: "explicit settled with zero posted", raw: `{"posted":0,"pending":false}`, want: false},
		{name: "explicit settled with positive posted", raw: `{"posted":1785628800,"pending":false}`, want: false},
		{name: "missing pending falls back to zero posted", raw: `{"posted":0}`, want: true},
		{name: "missing pending falls back to positive posted", raw: `{"posted":1785628800}`, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var transaction Transaction
			if err := json.Unmarshal([]byte(test.raw), &transaction); err != nil {
				t.Fatal(err)
			}
			facts := transactionFacts(transaction, "USD", "")
			if facts.Pending != test.want {
				t.Fatalf("facts pending = %v, want %v", facts.Pending, test.want)
			}
			encoded, err := json.Marshal(facts)
			if err != nil {
				t.Fatal(err)
			}
			var document map[string]any
			if err := json.Unmarshal(encoded, &document); err != nil {
				t.Fatal(err)
			}
			pending, ok := document["pending"].(bool)
			if !ok || pending != test.want {
				t.Fatalf("persisted pending = %#v, want boolean %v in %s", document["pending"], test.want, encoded)
			}
		})
	}
}

func TestBridgeAccountTypeHintIsAllowlistedMetadata(t *testing.T) {
	var transaction Transaction
	if err := json.Unmarshal([]byte(`{"id":"one","description":"CARD PURCHASE","amount":"-25","posted":1785628800,"extra":{"type":"credit_card","account_id":"private-id"}}`), &transaction); err != nil {
		t.Fatal(err)
	}
	account := Account{ID: "bank", ConnID: testConnID, Currency: "USD", Balance: "-25", Transactions: []Transaction{transaction}, Extra: map[string]json.RawMessage{
		"type":       json.RawMessage(`"credit_card"`),
		"account_id": json.RawMessage(`"private-account-id"`),
	}}
	translation, err := Translate(&AccountSet{Accounts: []Account{account}}, map[string]string{testAccountKey("bank"): "checking"}, time.Unix(1785628800, 0))
	if err != nil || len(translation.Settled) != 1 {
		t.Fatalf("translation=%+v err=%v", translation, err)
	}
	metadata := translation.Settled[0].Facts.Metadata
	if metadata[accountTypeMetadata] != "credit_card" {
		t.Fatalf("metadata=%+v", metadata)
	}
	for _, secret := range []string{"private-account-id", "account_id"} {
		for _, value := range metadata {
			if value == secret {
				t.Fatalf("unallowlisted bridge extra retained: %+v", metadata)
			}
		}
	}
}

func TestEvidencePreservesFullSourceAndRefreshesKnownSettledKeys(t *testing.T) {
	var transaction Transaction
	if err := json.Unmarshal([]byte(`{"id":"one","description":"`+strings.Repeat("x", 100)+` KLARNA PAY IN 4","amount":"-25","posted":1785628800,"payee":"Klarna","memo":"Installment","extra":{"payment_product":"pay-in-four","secret":"do not retain","category":{"unrecognized":true}}}`), &transaction); err != nil {
		t.Fatal(err)
	}
	set := &AccountSet{Accounts: []Account{{ID: "bank", ConnID: testConnID, Currency: "USD", Balance: "100", Transactions: []Transaction{transaction}}}}
	translation, err := Translate(set, map[string]string{testAccountKey("bank"): "checking"}, time.Unix(1785628800, 0))
	if err != nil || len(translation.Settled) != 1 {
		t.Fatalf("translation=%+v err=%v", translation, err)
	}
	item := translation.Settled[0]
	if len([]rune(item.Name)) != 80 || item.Facts.Description != transaction.Description || item.Facts.Payee != "Klarna" || item.Facts.Metadata["secret"] != "" || item.Facts.Metadata["category"] != "" {
		t.Fatalf("evidence=%+v", item.Facts)
	}
	bank := []store.BankRow{{Transaction: types.Transaction{ID: "existing", Name: "Owner edited label", Source: store.SourceBankSync}, Keys: []store.BankKey{candidateKey(item)}}}
	directives := Reconcile(nil, translation.Settled, bank, map[string]bool{"checking": true})
	if len(directives) != 1 || directives[0].Observe == nil || directives[0].Upsert != nil || directives[0].Convert != nil {
		t.Fatalf("known settled evidence refresh overwrites financial row: %+v", directives)
	}
}
