package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
	"math"
	"testing"
)

func TestLoanUsesPrincipalOnlyAndPaysInterestFirst(t *testing.T) {
	b, err := BuildLoan("p", "i", "charge", "pay", types.LoanTerms{Name: "Loan", Principal: 12000, AccruedInterest: 237.54, ObservedAt: 1783987199, AnnualRate: 0.0399, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 300, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	accounts := append(b.Accounts, types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true, Display: types.PassthroughDisplay("cash", "Cash")})
	model := &types.FinancialModel{Accounts: accounts, Schedules: b.Schedules, Checkpoints: b.Checkpoints, Evaluations: types.EmptyEvaluationTables()}
	for _, issue := range ValidateFinanceModel(model) {
		if issue.Severity == types.SeverityError {
			t.Fatalf("invalid bundle: %+v", issue)
		}
	}
	run, err := Simulate(types.SimulationRequest{Model: types.SimulationInputs{Accounts: accounts, Schedules: b.Schedules}, InitialState: types.SimulationState{Balances: map[string]float64{"p": -12000, "i": -237.54, "cash": 1000}}, StartDate: "2026-08-12", EndDate: "2026-08-13"})
	if err != nil {
		t.Fatal(err)
	}
	// 12000 * .0399 / 12 = 39.90. The $300 payment clears $277.44
	// interest, then reduces principal by $22.56.
	for id, want := range map[string]float64{"p": -11977.44, "i": 0, "cash": 700} {
		if math.Abs(run.FinalState.Balances[id]-want) > 0.000001 {
			t.Errorf("%s balance = %v, want %v", id, run.FinalState.Balances[id], want)
		}
	}
	if got := ComputeNetWorth(run.FinalState.Balances, accounts); math.Abs(got-(-11277.44)) > 0.000001 {
		t.Fatalf("net worth double counted display: %v", got)
	}
	model.Accounts[1].Enabled = false
	if !hasErrorCode(ValidateFinanceModel(model), "account.display.invalid") {
		t.Fatal("accepted inconsistent inclusion")
	}
}

func TestVisibleLoanGoalIncludesOutstandingInterest(t *testing.T) {
	display := &types.AccountDisplay{Components: []types.AccountComponent{{AccountID: "p", Role: "principal"}, {AccountID: "i", Role: "interest"}}}
	path := pathOf(row("2026-01-01", false, 0, map[string]float64{"p": 0, "i": -10}), row("2026-02-01", false, 0, map[string]float64{"p": 0, "i": 0}))
	path.EffectiveModel.Accounts = []types.Account{{ID: "p", Display: display}, {ID: "i"}}
	result := EvaluateAccountBalance(path, "p", 0)
	if !result.Reached || result.FirstReachedDate == nil || *result.FirstReachedDate != "2026-02-01" {
		t.Fatalf("goal ignored interest: %+v", result)
	}
}

func TestLoanRejectsRulesTheFormCannotRepresent(t *testing.T) {
	b, err := BuildLoan("p", "i", "charge", "pay", types.LoanTerms{Name: "Loan", ObservedAt: 1, AnnualRate: 0.12, InterestFrequency: "monthly", InterestStartDate: "2026-01-01", PaymentFrequency: "monthly", PaymentStartDate: "2026-01-01", FundingAccountID: "cash"})
	if err != nil {
		t.Fatal(err)
	}
	b.Schedules[1].Amount.Config["expression"] = "abs(p) * .01"
	if _, _, _, err := LoanRuleTerms("p", b.Schedules[0], b.Schedules[1]); err == nil {
		t.Fatal("accepted a calculated payment")
	}
	for _, literal := range []string{"+91.08", "91.081"} {
		b.Schedules[1].Amount.Config["expression"] = literal
		if _, _, _, err := LoanRuleTerms("p", b.Schedules[0], b.Schedules[1]); err == nil {
			t.Fatalf("accepted a payment the form cannot round-trip: %s", literal)
		}
	}
	b.Schedules[1].Amount.Config["expression"] = "91.08"
	b.Schedules[0].Amount.Config["expression"] = "abs(principal) * rate + 5"
	if _, _, _, err := LoanRuleTerms("p", b.Schedules[0], b.Schedules[1]); err == nil {
		t.Fatal("accepted custom interest")
	}
}
