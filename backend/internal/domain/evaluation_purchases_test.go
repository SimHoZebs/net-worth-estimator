package domain

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func purchaseEvaluation() []types.EvaluationInstance[types.JsonValue] {
	return []types.EvaluationInstance[types.JsonValue]{{InstanceID: "purchases", Name: "Planned purchases", Enabled: true, Config: map[string]any{}}}
}

func TestPlannedPurchasesEvaluationProtectsPaymentsInPrivateBranch(t *testing.T) {
	request := purchaseRequest(1000,
		purchasePosting("laptop", "2025-01-01", "500", 0),
		purchasePosting("chair", "2026-02-01", "150", 1),
		establishedPosting("rent", "2026-02-02", "900", false),
		establishedPosting("pay", "2026-02-05", "1000", true))
	document := types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings,
		Checkpoints: []types.Checkpoint{{AccountID: "cash", Date: request.StartDate, Balance: 1000}}}
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: request.StartDate, HorizonYears: 1}
	settings.Evaluations.PlannedPurchases = purchaseEvaluation()
	before := toAny(t, document)
	result, err := ProjectFinancialModelDocument(&document, &settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Evaluations.PlannedPurchases) != 1 || result.Evaluations.PlannedPurchases[0].Status != types.StatusSatisfied {
		t.Fatalf("evaluation = %+v", result.Evaluations.PlannedPurchases)
	}
	raw, _ := json.Marshal(result.Evaluations.PlannedPurchases[0].Deterministic)
	var analysis PlannedPurchasesPathResult
	if err := json.Unmarshal(raw, &analysis); err != nil {
		t.Fatal(err)
	}
	if !analysis.AllFunded || len(analysis.Purchases) != 2 {
		t.Fatalf("analysis = %+v", analysis)
	}
	for _, purchase := range analysis.Purchases {
		if purchase.Date == nil || *purchase.Date != "2026-02-05" {
			t.Fatalf("purchase = %+v", purchase)
		}
	}
	if result.Summary.FinalNetWorth != 1100 || result.Totals.ExternalOutflowAmount != 900 || len(result.TransactionEvents) != 2 {
		t.Fatalf("branch affected baseline: %+v", result)
	}
	if !reflect.DeepEqual(before, toAny(t, document)) {
		t.Fatal("evaluation mutated canonical input")
	}
}

func TestPlannedPurchasesLeaveProjectionBandsAndFIUnchanged(t *testing.T) {
	fixture := loadGolden(t, "stochastic.json")
	document := decodeDocument(t, fixture["document"])
	settings := decodeSettings(t, fixture["settings"])
	// Exercise actual sampled income as well as the existing FI branch.
	document.RecurrenceRules[0].Amount = types.PostingAmountResolution{Resolver: "expression",
		Config: map[string]any{"expression": "rate * 12"},
		Inputs: map[string]types.AmountInputBinding{"rate": {Source: "provider", Provider: "occurrence-rate",
			Arguments: map[string]any{"annualRate": 100.0, "volatility": 10.0}}}}
	baseline, err := ProjectFinancialModelDocument(document, settings, types.ModelOverrides{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	seed := int64(42)
	config := types.StochasticConfig{RunCount: 3, Seed: &seed}
	bands, err := StochasticProjection(context.Background(), document, settings, types.ModelOverrides{}, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, priority := range []int{0, 2} {
		purchase := purchasePosting("laptop", "2026-02-01", "500", priority)
		purchase.SourceAccountID = &document.Accounts[0].ID
		other := purchasePosting("chair", "2026-02-03", "150", 1)
		other.SourceAccountID = purchase.SourceAccountID
		document.Postings = []types.Posting{purchase, other}
		settings.Evaluations.PlannedPurchases = purchaseEvaluation()
		result, err := ProjectFinancialModelDocument(document, settings, types.ModelOverrides{}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Evaluations.PlannedPurchases) != 1 || result.Evaluations.PlannedPurchases[0].Deterministic == nil {
			t.Fatal("isolated evaluation missing")
		}
		result.Evaluations.PlannedPurchases = nil
		if !reflect.DeepEqual(baseline, result) {
			compareValues(t, "projection", toAny(t, baseline), toAny(t, result))
			t.Fatal("purchase inputs, evaluation, or priority changed baseline/FI result")
		}
		sampled, err := StochasticProjection(context.Background(), document, settings, types.ModelOverrides{}, config, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(sampled.Evaluations.PlannedPurchases) != 1 || sampled.Evaluations.PlannedPurchases[0].Probabilistic == nil {
			t.Fatal("sampled evaluation missing")
		}
		sampled.Evaluations.PlannedPurchases = nil
		if !reflect.DeepEqual(bands, sampled) {
			t.Fatal("purchase inputs, evaluation, or priority changed scenario bands/FI result")
		}
	}
}

func TestPlannedPurchasesSampleUsesTheBaselineSample(t *testing.T) {
	request := purchaseRequest(0, purchasePosting("want", "2026-02-01", "50", 0))
	end := "2026-03-01"
	request.Model.RecurrenceRules = []types.RecurrenceRule{{ID: "pay", Destinations: []string{"cash"}, Enabled: true,
		Frequency: types.FrequencyMonthly, StartDate: "2026-02-02", EndDate: &end,
		Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "rate * 12"},
			Inputs: map[string]types.AmountInputBinding{"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 100.0, "volatility": 1.0}}}},
	}}
	document := types.FinancialModelDocument{Accounts: request.Model.Accounts, Postings: request.Model.Postings, RecurrenceRules: request.Model.RecurrenceRules}
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: request.StartDate, HorizonYears: 1}
	for _, rate := range []float64{0, 100} {
		sample := &types.MonteCarloSample{AnnualRatesByPostingID: map[string][]float64{"pay": {rate}}}
		path, _, err := ProjectRawFinancialModelDocument(&document, &settings, types.ModelOverrides{}, sample)
		if err != nil {
			t.Fatal(err)
		}
		result, err := evaluatePlannedPurchases(&EvaluationContext{Path: path, MonteCarloSample: sample}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if result.(*PlannedPurchasesPathResult).AllFunded != (rate > 0) {
			t.Fatalf("evaluation ignored sample %v: %+v", rate, result)
		}
	}
}

func TestPlannedPurchasesValidationAndDisabledEvaluation(t *testing.T) {
	for _, config := range []any{nil, []any{}, map[string]any{"queue": true}} {
		if validatePlannedPurchasesConfig(config) == nil {
			t.Fatalf("accepted config %v", config)
		}
	}
	tables := types.EmptyEvaluationTables()
	tables.PlannedPurchases = purchaseEvaluation()
	tables.PlannedPurchases[0].Enabled = false
	runtimes := NewEvaluationRuntimeSet(&tables, evaluationRegistryInstance)
	runtimes.EvaluateDeterministic(&EvaluationContext{})
	result := runtimes.Result().Evaluations.PlannedPurchases[0]
	if result.Status != types.StatusIndeterminate || result.Deterministic != nil {
		t.Fatalf("disabled evaluation ran: %+v", result)
	}
}
