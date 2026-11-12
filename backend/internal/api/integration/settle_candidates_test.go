package integration

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSettleCandidatesEndpoint(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	// Single-row debts are legacy fixtures: seed through the store since
	// POST /v1/accounts rejects kind=debt in favor of POST /v1/loans.
	seeded, err := database.CreateAccount(types.Account{Name: "Card", Kind: "debt", Enabled: true})
	if err != nil {
		t.Fatalf("seed account: %v", err)
	}
	accountID := seeded.ID

	holdTime := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC).Unix()
	hold := types.Transaction{
		Name:            "LYFT *TEMP AUTH HOLD",
		Source:          store.SourceBankSync,
		SourceAccountID: ptr(accountID),
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "74.94"}, Inputs: map[string]types.AmountInputBinding{}},
		TransactionTime: holdTime,
		Enabled:         false,
		Pending:         true,
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{
			Transaction: hold,
			Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-card", TransactionID: "auth1"}},
		},
	}}); err != nil {
		t.Fatalf("hold upsert: %v", err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	var holdID string
	for _, transaction := range model.Transactions {
		if transaction.Name == hold.Name {
			holdID = transaction.ID
		}
	}
	if holdID == "" {
		t.Fatalf("hold missing in %+v", model.Transactions)
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{Void: holdID}}); err != nil {
		t.Fatalf("hold void: %v", err)
	}

	postedTime := time.Date(2026, 11, 1, 14, 36, 0, 0, time.UTC).Unix()
	settled := types.Transaction{
		Name:            "LYFT *STANDARD 10-30",
		Source:          store.SourceBankSync,
		SourceAccountID: ptr(accountID),
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "81.22"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      postedTime,
		TransactionTime: postedTime,
		Enabled:         true,
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{
			Transaction: settled,
			Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-card", TransactionID: "post1"}},
		},
	}}); err != nil {
		t.Fatalf("settled upsert: %v", err)
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("reload model: %v", err)
	}
	var settledID string
	for _, transaction := range model.Transactions {
		if transaction.Name == settled.Name {
			settledID = transaction.ID
		}
	}
	if settledID == "" {
		t.Fatalf("settled charge missing in %+v", model.Transactions)
	}

	response := doRowRequest(t, handler, http.MethodGet, "/v1/transactions/"+holdID+"/settle-candidates", "")
	if response.Code != http.StatusOK {
		t.Fatalf("settle candidates status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		TransactionID string `json:"transactionId"`
		Candidates    []struct {
			TransactionID     string  `json:"transactionId"`
			Name              string  `json:"name"`
			Amount            float64 `json:"amount"`
			Date              string  `json:"date"`
			DayGap            int     `json:"dayGap"`
			AmountDeltaCents  int64   `json:"amountDeltaCents"`
			DescriptorChanged bool    `json:"descriptorChanged"`
			Recommended       bool    `json:"recommended"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode candidates: %v", err)
	}
	if payload.TransactionID != holdID || len(payload.Candidates) != 1 {
		t.Fatalf("candidates = %+v, want one for %s", payload, holdID)
	}
	candidate := payload.Candidates[0]
	if candidate.Name != "LYFT *STANDARD 10-30" || candidate.Amount != 81.22 {
		t.Fatalf("candidate = %+v, want the posted Lyft charge", candidate)
	}
	if candidate.Date != "2026-11-01" || candidate.DayGap != 1 {
		t.Fatalf("candidate date = %+v, want Nov 1 and one day", candidate)
	}
	if candidate.AmountDeltaCents != 628 || !candidate.DescriptorChanged || !candidate.Recommended {
		t.Fatalf("candidate evidence = %+v, want delta 628, changed, recommended", candidate)
	}

	notHold := doRowRequest(t, handler, http.MethodGet, "/v1/transactions/"+settledID+"/settle-candidates", "")
	if notHold.Code != http.StatusBadRequest {
		t.Fatalf("settled transaction status = %d, want 400", notHold.Code)
	}
	missing := doRowRequest(t, handler, http.MethodGet, "/v1/transactions/missing/settle-candidates", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.Code)
	}
}
