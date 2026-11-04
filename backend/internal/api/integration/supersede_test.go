package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSupersedeAccountEndpointRetiresManualAccount(t *testing.T) {
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{
		ID: "manual", Name: "Joint Checking", Kind: types.AccountKindCash,
		Color: supersedeColor("#123456"), Enabled: true,
	}); err != nil {
		t.Fatalf("seed manual account: %v", err)
	}
	if _, err := database.CreateAccount(types.Account{
		ID: "synced", Name: "Bank Checking", Kind: types.AccountKindCash, Enabled: true,
	}); err != nil {
		t.Fatalf("seed synced account: %v", err)
	}
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	if _, err := database.ApplySync([]store.SyncCheckpoint{{
		AccountID: "synced", Balance: 700, Source: store.SourceBankSync,
		Provider: store.ProviderSimpleFIN, ObservedAt: 1782950400,
	}}, nil); err != nil {
		t.Fatalf("seed bank checkpoint: %v", err)
	}
	handler := New(database, Config{})
	response := doRowRequest(t, handler, http.MethodPost, "/v1/sync/simplefin/accounts/bridge-1/supersede",
		`{"manualAccountId":"manual"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("supersede status = %d, body %s", response.Code, response.Body.String())
	}
	var result struct {
		ManualAccountID string                       `json:"manualAccountId"`
		SyncedAccountID string                       `json:"syncedAccountId"`
		Issues          []types.ModelValidationIssue `json:"issues"`
		Saved           bool                         `json:"saved"`
		Revision        string                       `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode supersede: %v", err)
	}
	if !result.Saved || result.ManualAccountID != "manual" || result.SyncedAccountID != "synced" {
		t.Fatalf("supersede = %+v", result)
	}
	for _, issue := range result.Issues {
		if issue.Severity == types.SeverityError {
			t.Fatalf("supersede saved an error issue: %+v", issue)
		}
	}
	assertSavedModelIdentity(t, database, result.Revision)
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	if len(model.Accounts) != 1 || model.Accounts[0].ID != "synced" || model.Accounts[0].Name != "Joint Checking" {
		t.Fatalf("accounts after supersede = %+v", model.Accounts)
	}
}

func TestSupersedeAccountEndpointReturnsIssuesWithoutPersisting(t *testing.T) {
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{
		ID: "manual", Name: "Manual", Kind: types.AccountKindCash, Enabled: true,
	}); err != nil {
		t.Fatalf("seed manual account: %v", err)
	}
	if _, err := database.CreateAccount(types.Account{
		ID: "synced", Name: "Synced", Kind: types.AccountKindCash, Enabled: true,
	}); err != nil {
		t.Fatalf("seed synced account: %v", err)
	}
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	source := "synced"
	if _, err := database.CreatePosting(types.Posting{
		ID: "01900000-0000-7000-8000-0000000000c1", Name: "Broken",
		SourceAccountID: &source, Destinations: []string{"ghost"},
		Amount:     types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime: 1782950400, TransactionTime: 1782950400, Enabled: true,
	}); err != nil {
		t.Fatalf("seed broken posting: %v", err)
	}
	handler := New(database, Config{})
	response := doRowRequest(t, handler, http.MethodPost, "/v1/sync/simplefin/accounts/bridge-1/supersede",
		`{"manualAccountId":"manual"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("supersede status = %d, body %s", response.Code, response.Body.String())
	}
	var result struct {
		Issues []types.ModelValidationIssue `json:"issues"`
		Saved  bool                         `json:"saved"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode supersede: %v", err)
	}
	if result.Saved || !hasErrorIssues(result.Issues) {
		t.Fatalf("supersede = %+v, want saved false with errors", result)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	if len(model.Accounts) != 2 {
		t.Fatalf("rejected supersede changed accounts: %+v", model.Accounts)
	}
}

func TestSupersedeAccountEndpointRejectsUnknownBridge(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := doRowRequest(t, handler, http.MethodPost, "/v1/sync/simplefin/accounts/missing/supersede",
		`{"manualAccountId":"manual"}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown bridge status = %d, body %s", response.Code, response.Body.String())
	}
}

func supersedeColor(value string) *string { return &value }
