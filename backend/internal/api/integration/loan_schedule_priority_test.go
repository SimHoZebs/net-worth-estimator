package integration

import (
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestNewLoanAppendsSchedulesAndEditsPreservePriorities(t *testing.T) {
	st := openAPIStore(t)
	zero := 0.0
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true, MinBalance: &zero}); err != nil {
		t.Fatal(err)
	}
	funding := "checking"
	if _, err := st.CreateSchedule(types.Schedule{ID: "existing-payment", Name: "Existing payment", SourceAccountID: &funding, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}, Inputs: map[string]types.AmountInputBinding{}}, Priority: 20, Frequency: "monthly", StartDate: "2026-08-13", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	loan := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if !loan.Saved {
		t.Fatalf("create: %+v", loan)
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	priorities := map[string]int{}
	for _, schedule := range model.Schedules {
		priorities[schedule.ID] = schedule.Priority
	}
	display := loan.Result.Display
	if priorities[display.InterestScheduleID] != 21 || priorities[display.PaymentScheduleID] != 22 {
		t.Fatalf("loan did not append in interest-first order: %v", priorities)
	}
	interest := display.Components[1].AccountID
	run, err := domain.Simulate(types.SimulationRequest{Model: types.SimulationInputs{Accounts: model.Accounts, Schedules: model.Schedules}, InitialState: types.SimulationState{Balances: map[string]float64{"checking": 100, loan.Result.ID: -12000, interest: -237.54}}, StartDate: "2026-08-12", EndDate: "2026-08-13"})
	if err != nil {
		t.Fatal(err)
	}
	if run.FinalState.Balances["checking"] != 0 || run.FinalState.Balances[loan.Result.ID] != -12000 || run.FinalState.Balances[interest] != -277.44 {
		t.Fatalf("new loan preempted existing payment: %v", run.FinalState.Balances)
	}
	updated := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPut, "/v1/loans/"+loan.Result.ID, loanBody))
	if !updated.Saved {
		t.Fatalf("update: %+v", updated)
	}
	after, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, schedule := range after.Schedules {
		if schedule.Priority != priorities[schedule.ID] {
			t.Fatalf("edit changed %s priority", schedule.ID)
		}
	}
}
