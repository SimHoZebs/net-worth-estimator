package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func balanceRowsWithRevision(t *testing.T, handler http.Handler) ([]map[string]any, string) {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
	if response.Code != http.StatusOK {
		t.Fatalf("balances status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Accounts []map[string]any `json:"accounts"`
		Revision string           `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	return payload.Accounts, payload.Revision
}

func createNamedAccount(t *testing.T, handler http.Handler, name string) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{"name": name, "kind": "cash", "enabled": true})
	if err != nil {
		t.Fatal(err)
	}
	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", string(body))
	if created.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", created.Code, created.Body.String())
	}
	var payload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil || payload.Result.ID == "" {
		t.Fatalf("decode account: %v %s", err, created.Body.String())
	}
	return payload.Result.ID
}

func TestBusinessLogoKeyIsReadOnlyResponseMetadata(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	manualID := createNamedAccount(t, handler, "American Express Everyday")
	unknownID := createNamedAccount(t, handler, "Local Credit Union")

	rows, _ := balanceRowsWithRevision(t, handler)
	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[row["id"].(string)] = row
	}
	if byID[manualID]["recognizedBusinessKey"] != "american-express" {
		t.Fatalf("manual name key = %v", byID[manualID]["recognizedBusinessKey"])
	}
	if _, ok := byID[unknownID]["recognizedBusinessKey"]; ok {
		t.Fatalf("unknown account carries a key: %v", byID[unknownID])
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "recognizedBusinessKey") {
		t.Fatal("computed key leaked into canonical model persistence")
	}
}

func TestFidelityInvestmentsKeyIsReadOnlyResponseMetadata(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	manualID := createNamedAccount(t, handler, "Fidelity Investments brokerage")
	unknownID := createNamedAccount(t, handler, "Fidelity Bank")
	linkedID := createNamedAccount(t, handler, "Checking 2002")

	rows, _ := balanceRowsWithRevision(t, handler)
	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[row["id"].(string)] = row
	}
	if byID[manualID]["recognizedBusinessKey"] != "fidelity-investments" {
		t.Fatalf("manual Fidelity name key = %v", byID[manualID]["recognizedBusinessKey"])
	}
	if _, ok := byID[unknownID]["recognizedBusinessKey"]; ok {
		t.Fatalf("unrelated Fidelity Bank carries a key: %v", byID[unknownID])
	}

	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "sf2.test.fidelity",
		ModelAccountID:  linkedID,
		BridgeName:      "Brokerage",
		Institution:     "Fidelity Investments",
		Currency:        "USD",
		Origin:          store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("save link: %v", err)
	}
	rows, _ = balanceRowsWithRevision(t, handler)
	for _, row := range rows {
		if row["id"] == linkedID && row["recognizedBusinessKey"] != "fidelity-investments" {
			t.Fatalf("link institution key = %v", row["recognizedBusinessKey"])
		}
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "recognizedBusinessKey") {
		t.Fatal("Fidelity key leaked into canonical model persistence")
	}
}

func TestLinkOnlyUpdateRefreshesLogoWithoutModelRevisionChange(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	accountID := createNamedAccount(t, handler, "Checking 1001")

	beforeRows, beforeRevision := balanceRowsWithRevision(t, handler)
	beforeModel, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	beforeBytes, err := json.Marshal(beforeModel)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := beforeRows[0]["recognizedBusinessKey"]; ok {
		t.Fatalf("unlinked account carries a key: %v", beforeRows[0])
	}
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "sf2.test.logo",
		ModelAccountID:  accountID,
		BridgeName:      "Checking 1001",
		Institution:     "Chase",
		Currency:        "USD",
		Origin:          store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("save link: %v", err)
	}
	afterRows, afterRevision := balanceRowsWithRevision(t, handler)
	if afterRevision != beforeRevision {
		t.Fatalf("link-only update changed model revision: %q -> %q", beforeRevision, afterRevision)
	}
	afterModel, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	afterBytes, err := json.Marshal(afterModel)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("link-only update mutated the canonical model")
	}
	if afterRows[0]["recognizedBusinessKey"] != "chase" {
		t.Fatalf("link institution key = %v", afterRows[0]["recognizedBusinessKey"])
	}

	// Institution wins over the bridge name and owner name, with no model write.
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "sf2.test.logo",
		ModelAccountID:  accountID,
		BridgeName:      "Venmo balance",
		Institution:     "Chase",
		Currency:        "USD",
		Origin:          store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("update link: %v", err)
	}
	rows, revision := balanceRowsWithRevision(t, handler)
	if rows[0]["recognizedBusinessKey"] != "chase" || revision != beforeRevision {
		t.Fatalf("precedence = %v, revision = %q", rows[0]["recognizedBusinessKey"], revision)
	}
}
