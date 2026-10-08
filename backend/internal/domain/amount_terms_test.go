package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Terms-deferred amounts. Payment postings carry schedule and destinations;
// the numbers come from payment-terms rows through providers, so minimums
// live in exactly one place.

func termsTestContext() *AmountProviderContext {
	percent := 0.02
	return &AmountProviderContext{
		Balances:                     map[string]float64{"prime_card": -2000, "checking": 5000},
		LatestRealizedPostingAmounts: map[string]float64{},
		LatestRealizedPostingDates:   map[string]string{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
		PaymentTerms: map[string]types.PaymentTerms{
			"prime_card": {AccountID: "prime_card", MinimumFixed: 100, MinimumPercent: &percent, DueDay: 10},
		},
		Date: "2026-09-11",
	}
}

func TestTermsMinimumResolvesFixedFloor(t *testing.T) {
	// 2% of |-2000| is 40, below the 100 fixed floor.
	ctx := termsTestContext()
	value, err := amountProviders["terms-minimum"].resolve(map[string]types.JsonValue{"id": "prime_card"}, ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 100 {
		t.Fatalf("minimum = %v, want 100", value)
	}
}

func TestTermsMinimumPercentWinsAboveFixed(t *testing.T) {
	ctx := termsTestContext()
	ctx.Balances["prime_card"] = -20000 // 2% is 400, above the floor.
	value, err := amountProviders["terms-minimum"].resolve(map[string]types.JsonValue{"id": "prime_card"}, ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 400 {
		t.Fatalf("minimum = %v, want 400", value)
	}
}

func TestTermsMinimumRequiresTermsRow(t *testing.T) {
	ctx := termsTestContext()
	if _, err := amountProviders["terms-minimum"].resolve(map[string]types.JsonValue{"id": "ghost"}, ctx); err == nil {
		t.Fatalf("expected an error for an untermed account")
	}
	refs := &AmountReferenceContext{AccountIDs: map[string]bool{"prime_card": true}}
	if err := amountProviders["terms-minimum"].validateReferences(map[string]types.JsonValue{"id": "ghost"}, refs); err == nil {
		t.Fatalf("expected a reference error for an unknown account")
	}
}

func lateFeeArgs() map[string]types.JsonValue {
	return map[string]types.JsonValue{"payment": "pay-prime", "account": "prime_card", "fee": 30.0}
}

func TestLateFeeFiresOnSameMonthShortfall(t *testing.T) {
	ctx := termsTestContext()
	ctx.LatestRealizedPostingAmounts["pay-prime"] = 60 // minimum is 100.
	ctx.LatestRealizedPostingDates["pay-prime"] = "2026-09-10"
	value, err := amountProviders["late-fee"].resolve(lateFeeArgs(), ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 30 {
		t.Fatalf("fee = %v, want 30", value)
	}
}

func TestLateFeeSilentWhenPaidInFull(t *testing.T) {
	ctx := termsTestContext()
	ctx.LatestRealizedPostingAmounts["pay-prime"] = 100
	ctx.LatestRealizedPostingDates["pay-prime"] = "2026-09-10"
	value, err := amountProviders["late-fee"].resolve(lateFeeArgs(), ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 0 {
		t.Fatalf("fee = %v, want 0", value)
	}
}

func TestLateFeeSilentWithoutSameMonthPayment(t *testing.T) {
	ctx := termsTestContext()
	// Pre-history: the payment never executed.
	value, err := amountProviders["late-fee"].resolve(lateFeeArgs(), ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 0 {
		t.Fatalf("fee = %v, want 0", value)
	}
	// Stale: last execution was last month (for example a disabled shell).
	ctx.LatestRealizedPostingAmounts["pay-prime"] = 10
	ctx.LatestRealizedPostingDates["pay-prime"] = "2026-08-10"
	value, err = amountProviders["late-fee"].resolve(lateFeeArgs(), ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 0 {
		t.Fatalf("fee = %v, want 0", value)
	}
}

func TestLateFeeValidatesReferences(t *testing.T) {
	refs := &AmountReferenceContext{
		AccountIDs: map[string]bool{"prime_card": true},
		PostingIDs: map[string]bool{"pay-prime": true},
	}
	validate := amountProviders["late-fee"].validateReferences
	if err := validate(lateFeeArgs(), refs); err != nil {
		t.Fatalf("valid refs: %v", err)
	}
	bad := lateFeeArgs()
	bad["payment"] = "ghost"
	if err := validate(bad, refs); err == nil {
		t.Fatalf("expected an error for an unknown payment posting")
	}
	bad = lateFeeArgs()
	bad["fee"] = -5.0
	if err := validate(bad, refs); err == nil {
		t.Fatalf("expected an error for a negative fee")
	}
	// Fee shape is validated even though resolution reads it dynamically.
	if err := validate(map[string]types.JsonValue{"payment": "pay-prime"}, refs); err == nil {
		t.Fatalf("expected an error for a missing account")
	}
}

func termsPaymentModel() types.FinancialModel {
	checking := "checking"
	card := "prime_card"
	percent := 0.02
	return types.FinancialModel{
		Accounts: []types.Account{
			{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
			{ID: card, Name: "Prime Card", Kind: types.AccountKindDebt, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID: "pay-prime", Name: "Prime payment",
				SourceAccountID: &checking,
				Destinations:    []string{card},
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "minimum"},
					Inputs: map[string]types.AmountInputBinding{
						"minimum": {Source: "provider", Provider: "terms-minimum", Arguments: map[string]any{"id": card}},
					},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-09-10",
				Priority:  1,
				Enabled:   true,
			},
		},
		PaymentTerms: []types.PaymentTerms{
			{AccountID: card, MinimumFixed: 100, MinimumPercent: &percent, DueDay: 10},
		},
	}
}

func executeTermsOccurrence(t *testing.T, model types.FinancialModel, balances map[string]float64, date string) PostingExecutionTransition {
	t.Helper()
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     balances,
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-09-01", nil, nil)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	transition, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, date)
	if err != nil {
		t.Fatalf("execute posting: %v", err)
	}
	return transition
}

func TestPaymentAmountDefersToTerms(t *testing.T) {
	model := termsPaymentModel()
	transition := executeTermsOccurrence(t, model, map[string]float64{"checking": 5000, "prime_card": -2000}, "2026-09-10")
	if transition.Result.RequestedAmount != 100 || transition.Result.RealizedAmount != 100 {
		t.Fatalf("result = %+v, want 100/100 from terms", transition.Result)
	}
	// One edit to the terms row moves the payment: the posting is a shell.
	model.PaymentTerms[0].MinimumFixed = 250
	transition = executeTermsOccurrence(t, model, map[string]float64{"checking": 5000, "prime_card": -2000}, "2026-09-10")
	if transition.Result.RequestedAmount != 250 {
		t.Fatalf("requested = %v, want 250", transition.Result.RequestedAmount)
	}
}

func TestLateFeePostingAssessesShortfall(t *testing.T) {
	model := termsPaymentModel()
	floor := 0.0
	model.Accounts[0].MinBalance = &floor
	fee := 30.0
	model.Postings = append(model.Postings, types.Posting{
		ID: "fee-prime", Name: "Prime late fee",
		Destinations: []string{"prime_card"},
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "fee"},
			Inputs: map[string]types.AmountInputBinding{
				"fee": {Source: "provider", Provider: "late-fee", Arguments: map[string]any{"payment": "pay-prime", "account": "prime_card", "fee": fee}},
			},
		},
		Frequency: types.FrequencyMonthly,
		StartDate: "2026-09-11",
		Priority:  9,
		Enabled:   true,
	})
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     map[string]float64{"checking": 50, "prime_card": -2000},
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-09-01", nil, nil)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	// Checking holds 50 above a zero floor against a 100 minimum: the payment
	// realizes 50.
	payment, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-09-10")
	if err != nil {
		t.Fatalf("execute payment: %v", err)
	}
	if payment.Result.RealizedAmount != 50 {
		t.Fatalf("realized = %v, want 50", payment.Result.RealizedAmount)
	}
	assessed, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[1], Index: 1}, "2026-09-11")
	if err != nil {
		t.Fatalf("execute fee: %v", err)
	}
	if assessed.Result.RequestedAmount != 30 {
		t.Fatalf("fee = %v, want 30", assessed.Result.RequestedAmount)
	}
}

func balanceFeeArgs() map[string]types.JsonValue {
	return map[string]types.JsonValue{"account": "checking", "threshold": 1500.0, "fee": 12.0}
}

func TestBalanceFeeFiresBelowThreshold(t *testing.T) {
	ctx := termsTestContext()
	ctx.Balances["checking"] = 1400
	value, err := amountProviders["balance-fee"].resolve(balanceFeeArgs(), ctx)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != 12 {
		t.Fatalf("fee = %v, want 12", value)
	}
}

func TestBalanceFeeSilentAtOrAboveThreshold(t *testing.T) {
	ctx := termsTestContext()
	for _, balance := range []float64{1500, 1600} {
		ctx.Balances["checking"] = balance
		value, err := amountProviders["balance-fee"].resolve(balanceFeeArgs(), ctx)
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if value != 0 {
			t.Fatalf("balance %v: fee = %v, want 0", balance, value)
		}
	}
}

func TestBalanceFeeValidatesReferences(t *testing.T) {
	refs := &AmountReferenceContext{AccountIDs: map[string]bool{"checking": true}}
	validate := amountProviders["balance-fee"].validateReferences
	if err := validate(balanceFeeArgs(), refs); err != nil {
		t.Fatalf("valid refs: %v", err)
	}
	bad := balanceFeeArgs()
	bad["account"] = "ghost"
	if err := validate(bad, refs); err == nil {
		t.Fatalf("expected an error for an unknown account")
	}
	bad = balanceFeeArgs()
	bad["threshold"] = "1500"
	if err := validate(bad, refs); err == nil {
		t.Fatalf("expected an error for a non-numeric threshold")
	}
	bad = balanceFeeArgs()
	bad["fee"] = -1.0
	if err := validate(bad, refs); err == nil {
		t.Fatalf("expected an error for a negative fee")
	}
}

func TestBalanceFeePostingDebitsChecking(t *testing.T) {
	checking := "checking"
	model := types.FinancialModel{
		Accounts: []types.Account{
			{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		},
		Postings: []types.Posting{
			{
				ID: "checking-fee", Name: "Checking maintenance fee",
				SourceAccountID: &checking,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "fee"},
					Inputs: map[string]types.AmountInputBinding{
						"fee": {Source: "provider", Provider: "balance-fee", Arguments: map[string]any{"account": checking, "threshold": 1500.0, "fee": 12.0}},
					},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-09-01",
				Priority:  1,
				Enabled:   true,
			},
		},
	}
	runtime, err := CreateTransitionRuntime(model, SimulationState{
		Balances:                     map[string]float64{checking: 1400},
		LatestRealizedPostingAmounts: map[string]float64{},
		RealizedPostingAmountsByYear: map[string]map[string]float64{},
	}, "2026-09-01", nil, nil)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	assessed, err := runtime.ExecutePosting(DatedPostingOccurrence{Posting: &model.Postings[0], Index: 0}, "2026-09-01")
	if err != nil {
		t.Fatalf("execute fee: %v", err)
	}
	if assessed.Result.RequestedAmount != 12 || assessed.Result.RealizedAmount != 12 {
		t.Fatalf("result = %+v, want 12/12", assessed.Result)
	}
	if got := runtime.State.Balances[checking]; got != 1388 {
		t.Fatalf("balance = %v, want 1388", got)
	}
}
