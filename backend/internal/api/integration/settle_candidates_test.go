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

	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Card","kind":"debt","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", created.Code, created.Body.String())
	}
	var accountPayload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &accountPayload); err != nil {
		t.Fatalf("decode account: %v", err)
	}
	accountID := accountPayload.Result.ID

	holdTime := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC).Unix()
	hold := types.Posting{
		Name:            "LYFT *TEMP AUTH HOLD",
		Source:          store.SourceBankSync,
		SourceAccountID: ptr(accountID),
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "74.94"}, Inputs: map[string]types.AmountInputBinding{}},
		TransactionTime: holdTime,
		Enabled:         false,
		Pending:         true,
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{
			Posting: hold,
			Keys:    []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-card", TransactionID: "auth1"}},
		},
	}}); err != nil {
		t.Fatalf("hold upsert: %v", err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	var holdID string
	for _, posting := range model.Postings {
		if posting.Name == hold.Name {
			holdID = posting.ID
		}
	}
	if holdID == "" {
		t.Fatalf("hold missing in %+v", model.Postings)
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{Void: holdID}}); err != nil {
		t.Fatalf("hold void: %v", err)
	}

	postedTime := time.Date(2026, 11, 1, 14, 36, 0, 0, time.UTC).Unix()
	settled := types.Posting{
		Name:            "LYFT *STANDARD 10-30",
		Source:          store.SourceBankSync,
		SourceAccountID: ptr(accountID),
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "81.22"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      postedTime,
		TransactionTime: postedTime,
		Enabled:         true,
	}
	if _, err := database.ApplySync(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{
			Posting: settled,
			Keys:    []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge-card", TransactionID: "post1"}},
		},
	}}); err != nil {
		t.Fatalf("settled upsert: %v", err)
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("reload model: %v", err)
	}
	var settledID string
	for _, posting := range model.Postings {
		if posting.Name == settled.Name {
			settledID = posting.ID
		}
	}
	if settledID == "" {
		t.Fatalf("settled charge missing in %+v", model.Postings)
	}

	response := doRowRequest(t, handler, http.MethodGet, "/v1/postings/"+holdID+"/settle-candidates", "")
	if response.Code != http.StatusOK {
		t.Fatalf("settle candidates status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		PostingID  string `json:"postingId"`
		Candidates []struct {
			PostingID         string  `json:"postingId"`
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
	if payload.PostingID != holdID || len(payload.Candidates) != 1 {
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

	notHold := doRowRequest(t, handler, http.MethodGet, "/v1/postings/"+settledID+"/settle-candidates", "")
	if notHold.Code != http.StatusBadRequest {
		t.Fatalf("settled posting status = %d, want 400", notHold.Code)
	}
	missing := doRowRequest(t, handler, http.MethodGet, "/v1/postings/missing/settle-candidates", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.Code)
	}
}
