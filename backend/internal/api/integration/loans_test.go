package integration

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const loanBody = `{"name":"Sallie Mae","principal":12000,"accruedInterest":237.54,"observedAt":1783987199,"recordBalances":true,"annualRate":0.0399,"interestFrequency":"monthly","interestStartDate":"2026-08-13","payment":91.08,"paymentFrequency":"monthly","paymentStartDate":"2026-08-13","fundingAccountId":"checking","enabled":true}`

func TestLoanCreateUpdateAndPaymentRouting(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if !created.Saved || created.Result.Display == nil {
		t.Fatalf("create = %+v", created)
	}
	id := created.Result.ID
	d := created.Result.Display
	model := assertSavedModelIdentity(t, st, created.Revision)
	if len(model.Accounts) != 3 || len(model.Checkpoints) != 2 || len(model.Schedules) != 2 {
		t.Fatalf("incomplete loan: %+v", model)
	}
	balances := doRowRequest(t, h, http.MethodGet, "/v1/accounts/balances", "")
	var position struct {
		Accounts []struct {
			ID               string   `json:"id"`
			ComponentBalance *float64 `json:"componentBalance"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(balances.Body.Bytes(), &position); err != nil {
		t.Fatal(err)
	}
	precise := false
	for _, row := range position.Accounts {
		if row.ID == d.Components[1].AccountID && row.ComponentBalance != nil && *row.ComponentBalance == -237.54 {
			precise = true
		}
	}
	if !precise {
		t.Fatalf("component precision lost: %s", balances.Body.String())
	}
	if got := model.Schedules[1].Destinations; len(got) != 2 || got[0] != d.Components[1].AccountID || got[1] != id {
		t.Fatalf("payment order = %v", got)
	}
	// Editing only the name/rate preserves observations and stable IDs.
	var body map[string]any
	if err := json.Unmarshal([]byte(loanBody), &body); err != nil {
		t.Fatal(err)
	}
	body["name"], body["annualRate"], body["recordBalances"] = "Student loan", 0.05, false
	body["observedAt"] = 1784073599
	data, _ := json.Marshal(body)
	updated := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+id, string(data)))
	if !updated.Saved || updated.Result.Display.InterestScheduleID != d.InterestScheduleID {
		t.Fatalf("update = %+v", updated)
	}
	model = assertSavedModelIdentity(t, st, updated.Revision)
	if len(model.Checkpoints) != 2 {
		t.Fatal("terms-only edit fabricated observations")
	}
	// Single visible destination becomes interest-first engine destinations.
	transaction := `{"name":"Extra payment","date":"2026-08-14","amount":{"value":100},"sourceAccountId":"checking","destinations":["` + id + `"],"enabled":true}`
	payment := decodePlanEntrySave[types.Transaction](t, doRowRequest(t, h, http.MethodPost, "/v1/transactions", transaction))
	if !payment.Saved || len(payment.Result.Destinations) != 2 || payment.Result.Destinations[0] != d.Components[1].AccountID {
		t.Fatalf("routing = %+v", payment)
	}
	blocked := doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+id, `{"name":"Broken","kind":"debt","enabled":true}`)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("component edit = %d: %s", blocked.Code, blocked.Body.String())
	}
}

func TestLoanInvalidCreationWritesNothing(t *testing.T) {
	st := openAPIStore(t)
	h := New(st, Config{})
	result := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if result.Saved {
		t.Fatal("saved loan with missing funding account")
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model != nil && (len(model.Accounts) != 0 || len(model.Schedules) != 0 || len(model.Checkpoints) != 0) {
		t.Fatal("invalid loan partially persisted")
	}
}

func TestLoanDeleteRemovesOwnedRows(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	deleted := decodePlanEntrySave[string](t, doRowRequest(t, h, http.MethodDelete, "/v1/loans/"+created.Result.ID, ""))
	if !deleted.Saved {
		t.Fatalf("delete = %+v", deleted)
	}
	model := assertSavedModelIdentity(t, st, deleted.Revision)
	if len(model.Accounts) != 1 || len(model.Schedules) != 0 || len(model.Checkpoints) != 0 {
		t.Fatalf("owned rows remain: %+v", model)
	}
}

func TestLinkedLoanNameEditPreservesExactRuleAmounts(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	charge := &model.Schedules[0].Amount
	charge.Config["expression"] = "abs(principal_balance) * loan_rate"
	charge.Inputs["principal_balance"], charge.Inputs["loan_rate"] = charge.Inputs["principal"], charge.Inputs["rate"]
	delete(charge.Inputs, "principal")
	delete(charge.Inputs, "rate")
	model.Schedules[1].Amount.Config["expression"] = "91.0800"
	floor, color := -50000.0, "#dc2626"
	model.Accounts[1].MinBalance, model.Accounts[1].Color = &floor, &color
	if _, err := st.ImportModel(model); err != nil {
		t.Fatal(err)
	}
	before, _ := st.LoadModel()
	var body map[string]any
	if err := json.Unmarshal([]byte(loanBody), &body); err != nil {
		t.Fatal(err)
	}
	body["name"], body["recordBalances"] = "Renamed loan", false
	data, _ := json.Marshal(body)
	updated := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+created.Result.ID, string(data)))
	if !updated.Saved {
		t.Fatalf("name edit failed: %+v", updated)
	}
	after, _ := st.LoadModel()
	if !reflect.DeepEqual(before.Accounts[1].MinBalance, after.Accounts[1].MinBalance) || !reflect.DeepEqual(before.Accounts[1].Color, after.Accounts[1].Color) {
		t.Fatal("name edit changed component bounds or color")
	}
	for i := range before.Schedules {
		if !reflect.DeepEqual(before.Schedules[i].Amount, after.Schedules[i].Amount) {
			t.Fatal("name edit changed a linked rule amount")
		}
	}
}
