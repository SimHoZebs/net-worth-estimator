package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestBalanceAdjustmentsReadIsScopedAndPreservesExactEvidence(t *testing.T) {
	database := openAPIStore(t)
	for _, id := range []string{"checking", "other", "empty"} {
		if _, err := database.CreateAccount(types.Account{ID: id, Name: id, Kind: "cash", Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []types.Checkpoint{
		{AccountID: "checking", Balance: 1000, ObservedAt: 1773133200},
		{AccountID: "checking", Balance: 900, ObservedAt: 1773140400},
		{AccountID: "other", Balance: 50, ObservedAt: 1773140400},
	} {
		if _, err := database.SaveCheckpoint(row); err != nil {
			t.Fatal(err)
		}
	}
	handler := New(database, Config{})
	response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/checking/balance-adjustments", "")
	if response.Code != http.StatusOK {
		t.Fatalf("read: %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Adjustments []types.BalanceAdjustment `json:"adjustments"`
		Revision    string                    `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Adjustments) != 2 || payload.Revision == "" {
		t.Fatalf("missing observations or revision: %+v", payload)
	}
	row := payload.Adjustments[1]
	if row.AccountID != "checking" || row.ObservedAt != 1773140400 || row.PreviousBalance != 1000 || row.Balance != 900 || row.Adjustment != -100 {
		t.Fatalf("incorrect adjustment: %+v", row)
	}
	response = doRowRequest(t, handler, http.MethodGet, "/v1/accounts/empty/balance-adjustments", "")
	if response.Code != http.StatusOK {
		t.Fatalf("empty read: %s", response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Adjustments == nil || len(payload.Adjustments) != 0 {
		t.Fatalf("want empty list, got %+v", payload)
	}
	response = doRowRequest(t, handler, http.MethodGet, "/v1/accounts/missing/balance-adjustments", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown account: %d", response.Code)
	}
}
