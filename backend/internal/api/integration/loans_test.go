package integration

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
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

func TestLoanDeleteRejectsOrdinaryAccount(t *testing.T) {
	st := openAPIStore(t)
	ordinary, err := st.CreateAccount(types.Account{Name: "Checking", Kind: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	res := doRowRequest(t, h, http.MethodDelete, "/v1/loans/"+ordinary.ID, "")
	if res.Code != http.StatusNotFound {
		t.Fatalf("delete ordinary via loans status = %d, want 404: %s", res.Code, res.Body.String())
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model == nil || len(model.Accounts) != 1 {
		t.Fatalf("ordinary account must survive: %+v", model)
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

func TestSingleDebtViaAccountsIsRejected(t *testing.T) {
	st := openAPIStore(t)
	h := New(st, Config{})

	created := doRowRequest(t, h, http.MethodPost, "/v1/accounts", `{"name":"Card","kind":"debt","enabled":true}`)
	if created.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create debt status = %d, want 422: %s", created.Code, created.Body.String())
	}
	if !strings.Contains(created.Body.String(), "POST /v1/loans") {
		t.Fatalf("create debt must direct to POST /v1/loans: %s", created.Body.String())
	}
	if model, _ := st.LoadModel(); model != nil && len(model.Accounts) != 0 {
		t.Fatalf("rejected debt creation persisted: %+v", model.Accounts)
	}

	ordinary := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`))
	converted := doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+ordinary.Result.ID, `{"name":"Checking","kind":"debt","enabled":true}`)
	if converted.Code != http.StatusUnprocessableEntity {
		t.Fatalf("convert status = %d, want 422: %s", converted.Code, converted.Body.String())
	}
	if !strings.Contains(converted.Body.String(), "PUT /v1/loans") {
		t.Fatalf("convert must direct to PUT /v1/loans: %s", converted.Body.String())
	}

	// Legacy single-row debts stay editable when they keep kind=debt and
	// may leave kind=debt for another kind.
	legacy, err := st.CreateAccount(types.Account{Name: "Legacy", Kind: types.AccountKindDebt, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	kept := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+legacy.ID, `{"name":"Renamed","kind":"debt","enabled":true}`))
	if !kept.Saved || kept.Result.Name != "Renamed" {
		t.Fatalf("legacy debt edit = %+v", kept)
	}
	undone := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+legacy.ID, `{"name":"Renamed","kind":"cash","enabled":true}`))
	if !undone.Saved || undone.Result.Kind != types.AccountKindCash {
		t.Fatalf("debt to cash = %+v", undone)
	}

	missing := doRowRequest(t, h, http.MethodPatch, "/v1/accounts/missing-debt-id", `{"name":"Ghost","kind":"debt","enabled":true}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing debt update status = %d, want 404: %s", missing.Code, missing.Body.String())
	}
}

func TestLoanAdoptsLegacyDebtPreservingBalance(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	legacy, err := st.CreateAccount(types.Account{Name: "Legacy", Kind: types.AccountKindDebt, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveCheckpoint(types.Checkpoint{AccountID: legacy.ID, Balance: -5000, ObservedAt: 1783987199}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	adoptBody := `{"name":"Adopted","principal":5000,"accruedInterest":0,"observedAt":1784073599,"recordBalances":false,"annualRate":0,"interestFrequency":"monthly","interestStartDate":"2026-08-13","payment":0,"paymentFrequency":"monthly","paymentStartDate":"2026-08-13","fundingAccountId":"checking","enabled":true}`
	adopted := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+legacy.ID, adoptBody))
	if !adopted.Saved || adopted.Result.Display == nil {
		t.Fatalf("adopt = %+v", adopted)
	}
	if adopted.Result.ID != legacy.ID {
		t.Fatalf("principal id changed: %s want %s", adopted.Result.ID, legacy.ID)
	}
	if adopted.Result.Kind != types.AccountKindDebt {
		t.Fatalf("adopted kind = %s, want debt", adopted.Result.Kind)
	}
	d := adopted.Result.Display
	if len(d.Components) != 2 || d.Components[0].AccountID != legacy.ID || d.Components[0].Role != "principal" || d.Components[1].Role != "interest" {
		t.Fatalf("components = %+v", d.Components)
	}
	if adopted.Result.Name != "Adopted (Principal)" {
		t.Fatalf("principal name = %q, want Adopted (Principal)", adopted.Result.Name)
	}
	model := assertSavedModelIdentity(t, st, adopted.Revision)
	if len(model.Accounts) != 3 {
		t.Fatalf("accounts = %d, want 3", len(model.Accounts))
	}
	if len(model.Schedules) != 2 {
		t.Fatalf("schedules = %d, want 2", len(model.Schedules))
	}
	kept := false
	for _, c := range model.Checkpoints {
		if c.AccountID == legacy.ID && c.ObservedAt == 1783987199 && c.Balance == -5000 {
			kept = true
		}
	}
	if !kept {
		t.Fatalf("legacy checkpoint lost: %+v", model.Checkpoints)
	}
	interestID := d.Components[1].AccountID
	var interest types.Account
	for _, a := range model.Accounts {
		if a.ID == interestID {
			interest = a
		}
	}
	if interest.ID == "" || interest.Name != "Adopted (Interest)" {
		t.Fatalf("interest = %+v", interest)
	}
	var charge, payment types.Schedule
	for _, r := range model.Schedules {
		if r.ID == d.InterestScheduleID {
			charge = r
		}
		if r.ID == d.PaymentScheduleID {
			payment = r
		}
	}
	rate, amount, _, err := domain.LoanRuleTerms(legacy.ID, charge, payment)
	if err != nil {
		t.Fatal(err)
	}
	if rate != 0 || amount != 0 {
		t.Fatalf("inert rules = %v %v", rate, amount)
	}
	if payment.SourceAccountID == nil || *payment.SourceAccountID != "checking" {
		t.Fatalf("payment source = %+v", payment.SourceAccountID)
	}
}

func TestLoanAdoptsCashAccountToDebt(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	cash, err := st.CreateAccount(types.Account{Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	adopted := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+cash.ID, loanBody))
	if !adopted.Saved || adopted.Result.Display == nil {
		t.Fatalf("adopt cash = %+v", adopted)
	}
	if adopted.Result.ID != cash.ID || adopted.Result.Kind != types.AccountKindDebt {
		t.Fatalf("adopted = %+v", adopted.Result)
	}
	model := assertSavedModelIdentity(t, st, adopted.Revision)
	if len(model.Accounts) != 3 || len(model.Schedules) != 2 || len(model.Checkpoints) != 2 {
		t.Fatalf("incomplete adoption: %+v", model)
	}
}

func TestLoanAdoptsWithEmptyFundingOverHTTP(t *testing.T) {
	st := openAPIStore(t)
	cash, err := st.CreateAccount(types.Account{Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	adoptBody := `{"name":"Dormant","principal":2000,"accruedInterest":0,"observedAt":1784073599,"recordBalances":true,"annualRate":0,"interestFrequency":"monthly","interestStartDate":"2026-08-13","payment":0,"paymentFrequency":"monthly","paymentStartDate":"2026-08-13","fundingAccountId":"","enabled":true}`
	adopted := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+cash.ID, adoptBody))
	if !adopted.Saved || adopted.Result.Display == nil {
		t.Fatalf("empty-funding adopt = %+v", adopted)
	}
	for _, issue := range adopted.Issues {
		if issue.Severity == types.SeverityError {
			t.Fatalf("empty-funding adopt issue: %+v", issue)
		}
	}
	model := assertSavedModelIdentity(t, st, adopted.Revision)
	var payment types.Schedule
	for _, r := range model.Schedules {
		if r.ID == adopted.Result.Display.PaymentScheduleID {
			payment = r
		}
	}
	if payment.ID == "" {
		t.Fatalf("payment rule missing: %+v", model.Schedules)
	}
	if payment.SourceAccountID != nil {
		t.Fatalf("dormant payment source = %+v, want nil", payment.SourceAccountID)
	}
}

func TestLoanAdoptionRecordsNegativePrincipalForCashHistory(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	cash, err := st.CreateAccount(types.Account{Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveCheckpoint(types.Checkpoint{AccountID: cash.ID, Balance: 2000, ObservedAt: 1783987199}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	adoptBody := `{"name":"Converted","principal":2000,"accruedInterest":0,"observedAt":1784073599,"recordBalances":false,"annualRate":0,"interestFrequency":"monthly","interestStartDate":"2026-08-13","payment":0,"paymentFrequency":"monthly","paymentStartDate":"2026-08-13","fundingAccountId":"checking","enabled":true}`
	adopted := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+cash.ID, adoptBody))
	if !adopted.Saved || adopted.Result.Display == nil {
		t.Fatalf("adopt cash history = %+v", adopted)
	}
	model := assertSavedModelIdentity(t, st, adopted.Revision)
	negative := false
	for _, c := range model.Checkpoints {
		if c.AccountID == cash.ID && c.Balance == -2000 {
			negative = true
		}
	}
	if !negative {
		t.Fatalf("no negative principal observation: %+v", model.Checkpoints)
	}
}
func TestLoanDormantPairPassesDisplayValidation(t *testing.T) {
	bundle, err := domain.BuildLoan("p", "i", "charge", "pay", types.LoanTerms{Name: "Dormant", Principal: 1000, ObservedAt: 1, AnnualRate: 0, InterestFrequency: "monthly", InterestStartDate: "2026-01-01", Payment: 0, PaymentFrequency: "monthly", PaymentStartDate: "2026-01-01", FundingAccountID: "", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Schedules[1].SourceAccountID != nil {
		t.Fatalf("dormant payment source = %+v, want nil", bundle.Schedules[1].SourceAccountID)
	}
	rate, amount, _, err := domain.LoanRuleTerms("p", bundle.Schedules[0], bundle.Schedules[1])
	if err != nil {
		t.Fatal(err)
	}
	if rate != 0 || amount != 0 {
		t.Fatalf("dormant terms = %v %v", rate, amount)
	}
	model := &types.FinancialModel{Accounts: bundle.Accounts, Schedules: bundle.Schedules, Checkpoints: bundle.Checkpoints, Evaluations: types.EmptyEvaluationTables()}
	for _, issue := range domainValidate(model) {
		if issue.Severity == types.SeverityError {
			t.Fatalf("dormant pair invalid: %+v", issue)
		}
	}
}

func TestLoanUpdateMissingAndComponentConflicts(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	interestID := created.Result.Display.Components[1].AccountID
	missing := doRowRequest(t, h, http.MethodPut, "/v1/loans/missing-loan-id", loanBody)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing update status = %d, want 404: %s", missing.Code, missing.Body.String())
	}
	conflict := doRowRequest(t, h, http.MethodPut, "/v1/loans/"+interestID, loanBody)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("component update status = %d, want 409: %s", conflict.Code, conflict.Body.String())
	}
}
