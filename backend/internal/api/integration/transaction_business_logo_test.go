package integration

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type recordingTransactionEvidenceStore struct {
	store.Store
	reads int
	ids   []string
}

func (s *recordingTransactionEvidenceStore) LoadTransactionSourceFacts(transactionIDs []string) (map[string]types.TransactionFacts, error) {
	s.reads++
	s.ids = append(s.ids, transactionIDs...)
	return s.Store.LoadTransactionSourceFacts(transactionIDs)
}

func (s *recordingTransactionEvidenceStore) LoadBankTransactions() ([]store.BankRow, error) {
	return nil, errors.New("transaction list must not load all bank rows")
}

func transactionLogoRowsAt(t *testing.T, handler http.Handler, path string) (map[string]map[string]any, string) {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodGet, path, "")
	if response.Code != http.StatusOK {
		t.Fatalf("transactions status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Transactions []map[string]any `json:"transactions"`
		Revision     string           `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode transactions: %v", err)
	}
	rows := make(map[string]map[string]any, len(payload.Transactions))
	for _, row := range payload.Transactions {
		name, ok := row["name"].(string)
		if !ok {
			t.Fatalf("transaction row has no name: %v", row)
		}
		rows[name] = row
	}
	return rows, payload.Revision
}

func transactionLogoRows(t *testing.T, handler http.Handler) (map[string]map[string]any, string) {
	t.Helper()
	return transactionLogoRowsAt(t, handler, "/v1/transactions")
}

func TestTransactionBusinessLogoEvidencePrecedenceAndSafety(t *testing.T) {
	database := openAPIStore(t)
	scoped := &recordingTransactionEvidenceStore{Store: database}
	handler := New(scoped, Config{})
	accountID := createNamedAccount(t, handler, "Checking")
	savingsID := createNamedAccount(t, handler, "Savings")
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: simplefin.AccountKey("test-conn", "bank"),
		ModelAccountID:  accountID,
		BridgeName:      "Netflix balance",
		Institution:     "Netflix",
		Currency:        "USD",
		Origin:          store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("save link: %v", err)
	}

	posted := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC).Unix()
	feed := &simplefin.AccountSet{Accounts: []simplefin.Account{{
		ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", BalanceDate: posted,
		Transactions: []simplefin.Transaction{
			{
				ID: "merchant", Description: "NETFLIX.COM", Payee: "Uber", Amount: "-10", Posted: posted,
				Extra: map[string]json.RawMessage{"merchant_name": json.RawMessage(`"Spotify"`)},
			},
			{
				ID: "payee", Description: "Netflix payment", Payee: "UBER *TRIP", Amount: "-11", Posted: posted,
				Extra: map[string]json.RawMessage{"merchant_name": json.RawMessage(`"Local Shop"`)},
			},
			{ID: "name", Description: "SPOTIFY USA", Amount: "-12", Posted: posted},
			{ID: "paypal-refund", Description: "PAYPAL *REFUND", Amount: "10", Posted: posted},
			{ID: "amazon", Description: "AMZN MKTP US*2A3B4C5D3", Amount: "-18", Posted: posted},
			{ID: "lime", Description: "LIME*RIDE", Amount: "-6", Posted: posted},
			{ID: "airline", Description: "UNITED AIRLINES TICKET", Amount: "-180", Posted: posted},
			{ID: "fast-food", Description: "MCDONALD'S F12345", Amount: "-9", Posted: posted},
			{
				ID: "ambiguous", Description: "Netflix subscription", Payee: "Uber", Amount: "-13", Posted: posted,
				Extra: map[string]json.RawMessage{"merchant_name": json.RawMessage(`"Netflix Spotify"`)},
			},
			{
				ID: "shared-ambiguous", Description: "Klarna", Payee: "PayPal", Amount: "-13.50", Posted: posted,
				Extra: map[string]json.RawMessage{"merchant_name": json.RawMessage(`"PayPal Venmo"`)},
			},
			{ID: "unsupported", Description: "Local Cafe", Amount: "-14", Posted: posted},
		},
	}}}
	translation, err := simplefin.Translate(feed, map[string]string{simplefin.AccountKey("test-conn", "bank"): accountID}, time.Unix(posted, 0))
	if err != nil {
		t.Fatalf("translate feed: %v", err)
	}
	if _, err := database.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{accountID: true})); err != nil {
		t.Fatalf("apply sync: %v", err)
	}
	if _, err := database.CreateTransaction(types.Transaction{
		ID:              uuid.NewString(),
		Name:            "Netflix transfer",
		SourceAccountID: &accountID,
		Destinations:    []string{savingsID},
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "15"}},
		TransactionTime: posted,
		Enabled:         true,
		Source:          store.SourceUser,
	}); err != nil {
		t.Fatalf("create internal transfer: %v", err)
	}

	before, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	beforeBytes, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	wantRevision, err := store.ModelETag(before)
	if err != nil {
		t.Fatal(err)
	}

	rows, revision := transactionLogoRows(t, handler)
	if scoped.reads != 1 {
		t.Fatalf("source-fact reads = %d, want one batched store call", scoped.reads)
	}
	if revision != wantRevision {
		t.Fatalf("transaction revision = %q, want %q", revision, wantRevision)
	}
	for name, want := range map[string]string{
		"NETFLIX.COM":            "spotify",
		"Netflix payment":        "uber",
		"SPOTIFY USA":            "spotify",
		"PAYPAL *REFUND":         "paypal",
		"AMZN MKTP US*2A3B4C5D3": "amazon",
		"LIME*RIDE":              "lime",
		"UNITED AIRLINES TICKET": "united-airlines",
		"MCDONALD'S F12345":      "mcdonalds",
	} {
		if got := rows[name]["recognizedBusinessKey"]; got != want {
			t.Fatalf("%s key = %v, want %s", name, got, want)
		}
	}
	for _, name := range []string{"Netflix subscription", "Klarna", "Local Cafe", "Netflix transfer"} {
		if _, ok := rows[name]["recognizedBusinessKey"]; ok {
			t.Fatalf("%s carries a business key: %v", name, rows[name])
		}
	}
	eligibleIDs := map[string]bool{}
	for name, row := range rows {
		if name != "Netflix transfer" {
			eligibleIDs[row["id"].(string)] = true
		}
	}
	seenIDs := map[string]bool{}
	for _, id := range scoped.ids {
		if !eligibleIDs[id] || seenIDs[id] {
			t.Fatalf("evidence read included ineligible or duplicate ID %q", id)
		}
		seenIDs[id] = true
	}
	if len(seenIDs) != len(eligibleIDs) {
		t.Fatalf("evidence IDs = %v, want eligible rows %v", scoped.ids, eligibleIDs)
	}
	// The linked institution and bridge name are account metadata, not
	// transaction evidence, even when their text names a curated merchant.
	if _, ok := rows["Local Cafe"]["recognizedBusinessKey"]; ok {
		t.Fatal("account metadata leaked into transaction recognition")
	}

	// A filtered request whose only match is a two-sided transfer performs
	// no evidence query and never widens to the account's other bank rows.
	scoped.ids = nil
	filtered, _ := transactionLogoRowsAt(t, handler, "/v1/transactions?accountId="+savingsID)
	if len(filtered) != 1 || filtered["Netflix transfer"] == nil {
		t.Fatalf("filtered rows = %v, want only the internal transfer", filtered)
	}
	if len(scoped.ids) != 0 {
		t.Fatalf("filtered evidence IDs = %v, want none", scoped.ids)
	}

	after, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	afterBytes, err := json.Marshal(after)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("transaction logo reads mutated the canonical model")
	}
	if strings.Contains(string(afterBytes), "recognizedBusinessKey") {
		t.Fatal("computed transaction key leaked into model persistence")
	}
}
