package domain

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func purchasePosting(id, date, cost string, priority int) types.Posting {
	source := "cash"
	return types.Posting{
		ID: id, Name: id, SourceAccountID: &source, Enabled: true,
		PostedTime: midnightUnix(date), TransactionTime: midnightUnix(date),
		Amount:   types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": cost}},
		Purchase: &types.PurchasePolicy{Priority: priority},
	}
}

func purchaseRequest(balance float64, postings ...types.Posting) types.SimulationRequest {
	floor := 0.0
	return types.SimulationRequest{
		StartDate: "2026-02-01", EndDate: "2026-03-10", IncludeStartDateEvents: true,
		Model: types.FinancialModel{
			Accounts: []types.Account{{ID: "cash", Name: "Cash", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true}},
			Postings: postings,
		},
		InitialState: types.SimulationState{
			Balances: map[string]float64{"cash": balance}, LatestRealizedPostingAmounts: map[string]float64{},
			RealizedPostingAmountsByYear: map[string]map[string]float64{},
		},
	}
}

func establishedPosting(id, date, amount string, inflow bool) types.Posting {
	posting := purchasePosting(id, date, amount, 0)
	posting.Purchase = nil
	if inflow {
		posting.SourceAccountID = nil
		posting.Destinations = []string{"cash"}
	}
	return posting
}

func purchaseEvents(run types.SimulationRun) map[string]string {
	out := map[string]string{}
	for _, event := range run.MovementAttempts {
		for _, posting := range run.Request.Model.Postings {
			if posting.ID == event.Origin.PostingID && posting.Purchase != nil {
				out[posting.ID] = event.Date
			}
		}
	}
	return out
}

func TestPurchasesProtectFuturePayments(t *testing.T) {
	for _, recurring := range []bool{false, true} {
		t.Run(map[bool]string{false: "one-time", true: "recurring"}[recurring], func(t *testing.T) {
			request := purchaseRequest(1000,
				purchasePosting("laptop", "2026-02-01", "500", 0),
				purchasePosting("chair", "2026-02-01", "150", 1),
				establishedPosting("pay", "2026-02-05", "1000", true),
			)
			rent := establishedPosting("rent", "2026-02-02", "900", false)
			if recurring {
				end := "2026-02-02"
				request.Model.RecurrenceRules = []types.RecurrenceRule{{ID: rent.ID, Name: rent.Name,
					SourceAccountID: rent.SourceAccountID, Amount: rent.Amount, Frequency: types.FrequencyMonthly,
					StartDate: "2026-02-02", EndDate: &end, Enabled: true}}
			} else {
				request.Model.Postings = append(request.Model.Postings, rent)
			}
			before, _ := json.Marshal(request)
			run, err := simulatePurchases(request)
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]string{"laptop": "2026-02-05", "chair": "2026-02-05"}
			if got := purchaseEvents(run); !reflect.DeepEqual(got, want) {
				t.Fatalf("purchases = %v, want %v", got, want)
			}
			if HasFundingGapFrom(simulationPath(&run), request.StartDate) {
				t.Fatal("purchase created a funding gap")
			}
			after, _ := json.Marshal(request)
			if string(before) != string(after) {
				t.Fatal("trial mutated its input")
			}
		})
	}
}

func TestPurchaseQueueStrictOrderAndWholeItems(t *testing.T) {
	request := purchaseRequest(500,
		purchasePosting("cheap", "2026-02-01", "100", 1),
		purchasePosting("expensive", "2026-02-01", "600", 0),
	)
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); len(got) != 0 {
		t.Fatalf("blocked queue bought %v", got)
	}
	if run.FinalState.Balances["cash"] != 500 {
		t.Fatal("partial purchase spent money")
	}
	request.Model.Postings[0].Purchase.Priority = 0
	request.Model.Postings[1].Purchase.Priority = 1
	run, err = simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); !reflect.DeepEqual(got, map[string]string{"cheap": "2026-02-01"}) {
		t.Fatalf("reordered queue = %v", got)
	}
}

func TestPurchasesExecuteAfterEstablishedSameDayPayments(t *testing.T) {
	request := purchaseRequest(0, purchasePosting("want", "2026-02-01", "500", 0),
		establishedPosting("pay", "2026-02-01", "1500", true),
		establishedPosting("bill", "2026-02-01", "400", false))
	request.Model.Postings[2].TransactionTime++ // Pay arrives before the one-time bill.
	source := "cash"
	end := request.StartDate
	request.Model.RecurrenceRules = []types.RecurrenceRule{{ID: "rent", SourceAccountID: &source,
		Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "600"}},
		Frequency: types.FrequencyMonthly, StartDate: request.StartDate, EndDate: &end, Enabled: true}}
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(run.MovementAttempts) != 4 || run.MovementAttempts[3].Origin.PostingID != "want" || run.MovementAttempts[3].RealizedAmount != 500 {
		t.Fatalf("same-day execution = %+v", run.MovementAttempts)
	}
}

func TestPurchaseDatesAndDisabledItems(t *testing.T) {
	request := purchaseRequest(1000,
		purchasePosting("disabled", "2026-02-01", "999999", 0),
		purchasePosting("later", "2026-02-12", "500", 1),
		purchasePosting("too-late", "2027-01-01", "10", 2),
	)
	request.Model.Postings[0].Enabled = false
	request.IncludeStartDateEvents = false
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); !reflect.DeepEqual(got, map[string]string{"later": "2026-02-12"}) {
		t.Fatalf("dates = %v", got)
	}
}

func TestPurchaseNeverReplaysAsHistory(t *testing.T) {
	request := purchaseRequest(1000, purchasePosting("old-wish", "2025-01-01", "500", 0))
	document := types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings,
		Checkpoints: []types.Checkpoint{{AccountID: "cash", Date: request.StartDate, Balance: 1000}}}
	prepared, err := PrepareSimulationRequest(&document, &types.ProjectionRuntimeSettings{FallbackProjectionStartDate: request.StartDate, HorizonYears: 1}, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.Request.InitialState.LatestRealizedPostingAmounts) != 0 {
		t.Fatal("wish replayed in history")
	}
	run, err := simulatePurchases(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["old-wish"] != "2026-02-02" {
		t.Fatalf("past wish = %v", got)
	}
}

func TestPurchasesRespectAccountFloorAndDoNotPartiallyPurchase(t *testing.T) {
	request := purchaseRequest(1000, purchasePosting("want", "2026-02-01", "500.01", 0))
	floor := 500.0
	request.Model.Accounts[0].MinBalance = &floor
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(purchaseEvents(run)) != 0 || run.FinalState.Balances["cash"] != 1000 {
		t.Fatal("purchase breached its floor or partially executed")
	}
}

func TestPurchaseAtCheckpointDoesNotChangeBaselineBands(t *testing.T) {
	request := purchaseRequest(1000, purchasePosting("wish", "2025-01-01", "500", 0))
	document := types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings,
		Checkpoints: []types.Checkpoint{{AccountID: "cash", Date: request.StartDate, Balance: 1000}}}
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: request.StartDate, HorizonYears: 1}
	seed := int64(42)
	result, err := StochasticProjection(context.Background(), &document, &settings, types.ModelOverrides{}, types.StochasticConfig{RunCount: 5, Seed: &seed}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Bands) != 1 {
		t.Fatalf("purchase added a baseline date: %+v", result.Bands)
	}
	if result.Bands[0].Date != "2026-02-01" || !result.Bands[0].IsHistorical || result.Bands[0].NetWorth.P10 != 1000 || result.Bands[0].NetWorth.P90 != 1000 {
		t.Fatalf("historical band changed: %+v", result.Bands[0])
	}
}

func TestPurchasesCanResumeAfterExistingGap(t *testing.T) {
	request := purchaseRequest(100,
		purchasePosting("want", "2026-02-01", "50", 0),
		establishedPosting("bill", "2026-02-02", "200", false),
		establishedPosting("pay", "2026-02-03", "1000", true))
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["want"] != "2026-02-03" {
		t.Fatalf("resume = %v", got)
	}
}

func TestPurchaseProtectsPaymentsBelowReportDisplayThreshold(t *testing.T) {
	request := purchaseRequest(1000,
		purchasePosting("want", "2026-02-01", "500.01", 0),
		establishedPosting("bill", "2026-02-02", "500", false),
		establishedPosting("pay", "2026-02-03", "1000", true))
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["want"] != "2026-02-03" {
		t.Fatalf("cent-level gap did not defer purchase: %v", got)
	}
}

func TestPurchaseCanResumeAfterSameDayReplenishment(t *testing.T) {
	request := purchaseRequest(100,
		purchasePosting("want", "2026-02-01", "50", 0),
		establishedPosting("bill", "2026-02-02", "200", false),
		establishedPosting("pay", "2026-02-02", "1000", true))
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["want"] != "2026-02-02" {
		t.Fatalf("same-day replenishment = %v", got)
	}
	if !HasFundingGapFrom(simulationPath(&run), request.StartDate) {
		t.Fatal("pre-existing bill shortfall disappeared")
	}
}

func TestPurchaseValidation(t *testing.T) {
	for _, kind := range []string{"negative", "variable", "priority", "transfer", "empty-destinations", "claim", "dependency"} {
		t.Run(kind, func(t *testing.T) {
			request := purchaseRequest(1000, purchasePosting("want", "2026-02-01", "500", 0))
			posting := &request.Model.Postings[0]
			switch kind {
			case "negative":
				posting.Amount.Config["expression"] = "-1"
			case "variable":
				posting.Amount.Inputs = map[string]types.AmountInputBinding{"x": {Source: "literal", Value: 500.0}}
			case "priority":
				posting.Purchase.Priority = -1
			case "transfer":
				posting.Destinations = []string{"cash"}
			case "empty-destinations":
				posting.Destinations = []string{}
			case "claim":
				posting.Claim = &types.PostingClaim{RuleID: "missing", OccurrenceDate: request.StartDate}
			case "dependency":
				bill := establishedPosting("bill", "2026-02-02", "1", false)
				bill.Amount.Config["expression"] = "x"
				bill.Amount.Inputs = map[string]types.AmountInputBinding{"x": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "want"}}}
				request.Model.Postings = append(request.Model.Postings, bill)
			}
			issues := ValidateFinancialModel(&types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings})
			for _, issue := range issues {
				if issue.Severity == types.SeverityError {
					return
				}
			}
			t.Fatalf("invalid %s purchase accepted: %v", kind, issues)
		})
	}
}

func TestPurchaseProtectsDownstreamTransferAndLaterRecurringBill(t *testing.T) {
	request := purchaseRequest(1000,
		purchasePosting("want", "2026-02-01", "500", 0),
		establishedPosting("transfer", "2026-02-02", "900", false),
		establishedPosting("pay", "2026-02-04", "1000", true))
	floor := 0.0
	request.Model.Accounts = append(request.Model.Accounts, types.Account{ID: "bills", Kind: types.AccountKindCash, MinBalance: &floor, Enabled: true})
	request.Model.Postings[1].Destinations = []string{"bills"}
	account := "bills"
	end := "2026-02-03"
	request.Model.RecurrenceRules = []types.RecurrenceRule{{ID: "bill", SourceAccountID: &account,
		Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "900"}},
		Frequency: types.FrequencyMonthly, StartDate: end, EndDate: &end, Enabled: true}}
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["want"] != "2026-02-04" {
		t.Fatalf("downstream protection = %v", got)
	}
	if HasFundingGapFrom(simulationPath(&run), request.StartDate) {
		t.Fatal("downstream bill became underfunded")
	}
}

func TestPurchaseUsesCanonicalDestinationLimitDistinction(t *testing.T) {
	request := purchaseRequest(1000,
		purchasePosting("want", "2026-02-01", "500", 0),
		establishedPosting("transfer", "2026-02-02", "900", false))
	ceiling := 0.0
	request.Model.Accounts = append(request.Model.Accounts, types.Account{ID: "paid-debt", Kind: types.AccountKindDebt, MaxBalance: &ceiling, Enabled: true})
	request.Model.Postings[1].Destinations = []string{"paid-debt"}
	run, err := simulatePurchases(request)
	if err != nil {
		t.Fatal(err)
	}
	if got := purchaseEvents(run); got["want"] != request.StartDate {
		t.Fatalf("destination ceiling blocked purchase: %v", got)
	}
}

func TestPurchaseSamplePathsShareDatesAndRespectSampledIncome(t *testing.T) {
	request := purchaseRequest(0, purchasePosting("want", "2026-02-01", "50", 0))
	end := "2026-03-01"
	request.Model.RecurrenceRules = []types.RecurrenceRule{{ID: "pay", Destinations: []string{"cash"}, Enabled: true,
		Frequency: types.FrequencyMonthly, StartDate: "2026-02-02", EndDate: &end,
		Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "rate * 12"},
			Inputs: map[string]types.AmountInputBinding{"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 100.0, "volatility": 1.0}}}},
	}}
	var dates []string
	for _, rate := range []float64{0, 100} {
		request.MonteCarloSample = &types.MonteCarloSample{AnnualRatesByPostingID: map[string][]float64{"pay": {rate}}}
		run, err := simulatePurchases(request)
		if err != nil {
			t.Fatal(err)
		}
		gotDates := []string{}
		for _, snapshot := range run.Snapshots {
			gotDates = append(gotDates, snapshot.Date)
		}
		if dates == nil {
			dates = gotDates
		} else if !reflect.DeepEqual(dates, gotDates) {
			t.Fatalf("sample grids differ: %v %v", dates, gotDates)
		}
		if (len(purchaseEvents(run)) > 0) != (rate > 0) {
			t.Fatalf("purchase ignored sampled income %v: %v", rate, purchaseEvents(run))
		}
	}
	document := types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings, RecurrenceRules: request.Model.RecurrenceRules}
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: request.StartDate, HorizonYears: 1}
	seed := int64(42)
	config := types.StochasticConfig{RunCount: 10, Seed: &seed}
	first, err := StochasticProjection(context.Background(), &document, &settings, types.ModelOverrides{}, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := StochasticProjection(context.Background(), &document, &settings, types.ModelOverrides{}, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("seeded purchase runs differ")
	}
}

func TestPurchaseBranchPreservesSameDayPriority(t *testing.T) {
	wish := purchasePosting("wish", "2026-02-01", "500", 0)
	schedule := []scheduledPurchase{{posting: &wish, date: "2026-02-05"}}
	byDate := map[string][]DatedPostingOccurrence{"2026-02-05": {{Posting: &types.Posting{ID: "bill"}, Rule: &types.RecurrenceRule{}}}}
	appendScheduledPurchases(byDate, schedule)
	sortOccurrences(byDate["2026-02-05"])
	if byDate["2026-02-05"][1].Posting.ID != wish.ID {
		t.Fatal("branch purchase preempted a recurring payment")
	}
}
