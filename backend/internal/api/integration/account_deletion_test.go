package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestAccountDeleteCascadesManualHistory(t *testing.T) {
	st := openAPIStore(t)
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/accounts", `{"id":"delete-me","name":"Delete me","kind":"cash","enabled":true,"balance":321,"observedAt":1769903999}`))
	if !created.Saved {
		t.Fatalf("create account = %+v", created)
	}
	transaction := doRowRequest(t, h, http.MethodPost, "/v1/transactions", `{"name":"Dependent transfer","sourceAccountId":"delete-me","amount":{"value":21},"date":"2026-02-01","enabled":true}`)
	if transaction.Code != 200 {
		t.Fatalf("create transaction = %d %s", transaction.Code, transaction.Body.String())
	}

	deleted := doRowRequest(t, h, http.MethodDelete, "/v1/accounts/delete-me", "")
	if deleted.Code != 200 {
		t.Fatalf("delete account = %d %s", deleted.Code, deleted.Body.String())
	}
	var result struct {
		Saved     bool                         `json:"saved"`
		DeletedID string                       `json:"deletedId"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Revision  string                       `json:"revision"`
	}
	if err := json.Unmarshal(deleted.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Saved || result.DeletedID != "delete-me" || result.Revision == "" || len(result.Issues) != 0 {
		t.Fatalf("delete envelope = %+v", result)
	}
	model := assertSavedModelIdentity(t, st, result.Revision)
	if len(model.Accounts) != 0 || len(model.Transactions) != 0 || len(model.Checkpoints) != 0 {
		t.Fatalf("cascade left rows: accounts=%+v transactions=%+v checkpoints=%+v", model.Accounts, model.Transactions, model.Checkpoints)
	}
	if missing := doRowRequest(t, h, http.MethodDelete, "/v1/accounts/delete-me", ""); missing.Code != 404 {
		t.Fatalf("second delete = %d %s, want 404", missing.Code, missing.Body.String())
	}
}

func TestAccountDeleteRejectsLinkedAccount(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "linked", Name: "Linked", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge", ModelAccountID: "linked", BridgeName: "Linked"}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	balances := doRowRequest(t, h, http.MethodGet, "/v1/accounts/balances", "")
	if balances.Code != 200 {
		t.Fatalf("balances = %d %s", balances.Code, balances.Body.String())
	}
	var rows struct {
		Accounts []struct {
			ID        string `json:"id"`
			SyncOwned bool   `json:"syncOwned"`
			ReadOnly  bool   `json:"readOnly"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(balances.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows.Accounts) != 1 || !rows.Accounts[0].SyncOwned || !rows.Accounts[0].ReadOnly {
		t.Fatalf("linked account ownership = %+v", rows.Accounts)
	}
	response := doRowRequest(t, h, http.MethodDelete, "/v1/accounts/linked", "")
	if response.Code != 409 {
		t.Fatalf("delete linked account = %d %s, want 409", response.Code, response.Body.String())
	}
	model, err := st.LoadModel()
	if err != nil || model == nil || len(model.Accounts) != 1 || model.Accounts[0].ID != "linked" {
		t.Fatalf("linked account changed: %+v, %v", model, err)
	}
}

func TestAccountDeleteRemovesWholeLoan(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	loan := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if !loan.Saved || loan.Result.Display == nil {
		t.Fatalf("create loan = %+v", loan)
	}
	interestID := loan.Result.Display.Components[1].AccountID
	if deleted := doRowRequest(t, h, http.MethodDelete, "/v1/accounts/"+interestID, ""); deleted.Code != 200 {
		t.Fatalf("delete loan component = %d %s", deleted.Code, deleted.Body.String())
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Accounts) != 1 || model.Accounts[0].ID != "checking" || len(model.Schedules) != 0 || len(model.Checkpoints) != 0 {
		t.Fatalf("loan cascade left rows: accounts=%+v schedules=%+v checkpoints=%+v", model.Accounts, model.Schedules, model.Checkpoints)
	}
}
