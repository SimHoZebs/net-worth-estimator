package integration

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestLoanLinkPreservesExistingDestinationsOnUnrelatedEdits(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	loan := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if !loan.Saved {
		t.Fatalf("loan: %+v", loan)
	}
	id := loan.Result.ID
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	funding := "checking"
	amount := types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}, Inputs: map[string]types.AmountInputBinding{}}
	model.Transactions = append(model.Transactions, types.Transaction{ID: "principal-payment", Name: "Principal payment", SourceAccountID: &funding, Destinations: []string{id}, Amount: amount, PostedTime: 1786665600, TransactionTime: 1786665600, Enabled: true})
	model.Schedules = append(model.Schedules, types.Schedule{ID: "principal-schedule", Name: "Principal schedule", SourceAccountID: &funding, Destinations: []string{id}, Amount: amount, Frequency: "monthly", StartDate: "2026-08-14", Enabled: true})
	if _, err := st.ImportModel(model); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct{ method, path, body string }{
		{http.MethodPost, "/v1/transactions/principal-payment/amend", `{"name":"Renamed payment"}`},
		{http.MethodPost, "/v1/schedules/principal-schedule/amend", `{"name":"Renamed schedule"}`},
		{http.MethodPost, "/v1/transactions/principal-payment/claim", `{"scheduleId":"principal-schedule","occurrenceDate":"2026-08-14"}`},
		{http.MethodPost, "/v1/transactions/principal-payment/release", ""},
	} {
		response := doRowRequest(t, h, step.method, step.path, step.body)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", step.path, response.Code, response.Body.String())
		}
		if !decodePlanEntrySave[map[string]any](t, response).Saved {
			t.Fatalf("%s did not save: %s", step.path, response.Body.String())
		}
		saved, err := st.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		for _, transaction := range saved.Transactions {
			if transaction.ID == "principal-payment" && !reflect.DeepEqual(transaction.Destinations, []string{id}) {
				t.Fatalf("%s changed principal-only transaction", step.path)
			}
		}
		for _, schedule := range saved.Schedules {
			if schedule.ID == "principal-schedule" && !reflect.DeepEqual(schedule.Destinations, []string{id}) {
				t.Fatalf("%s changed principal-only schedule", step.path)
			}
		}
	}
}
