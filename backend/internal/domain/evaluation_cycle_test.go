package domain

import (
	"math"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func cycleEvent(date, postingID, accountID string, delta float64, sequence int) types.MovementEvent {
	return types.MovementEvent{
		Date:            types.IsoDate(date),
		Sequence:        sequence,
		Origin:          types.MovementOrigin{Type: "posting", PostingID: postingID},
		RequestedAmount: math.Abs(delta),
		RealizedAmount:  math.Abs(delta),
		AccountDeltas: []struct {
			AccountID string  `json:"accountId"`
			Delta     float64 `json:"delta"`
		}{{AccountID: accountID, Delta: delta}},
	}
}

func cyclePath(start string, postings []types.Posting, events []types.MovementEvent, buckets map[string]map[string]float64) *types.ProjectionPath {
	path := &types.ProjectionPath{
		MovementEvents:      events,
		EffectiveDocument:   types.FinancialModelDocument{Postings: postings},
		ProjectionStartDate: types.IsoDate(start),
		ProjectionEndDate:   types.IsoDate("2027-09-20"),
	}
	path.ProjectionStartPostingState.RealizedPostingAmountsByYear = buckets
	return path
}

func TestValidateCycleFulfillmentConfig(t *testing.T) {
	cases := []struct {
		name    string
		config  any
		wantErr bool
	}{
		{"valid", map[string]any{"accountIds": []any{"prime_card", "ultimate_card"}, "statementDay": 15.0, "budget": 800.0}, false},
		{"zero budget allowed", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 1.0, "budget": 0.0}, false},
		{"missing accounts", map[string]any{"statementDay": 15.0, "budget": 800.0}, true},
		{"empty accounts", map[string]any{"accountIds": []any{}, "statementDay": 15.0, "budget": 800.0}, true},
		{"null accounts", map[string]any{"accountIds": nil, "statementDay": 15.0, "budget": 800.0}, true},
		{"blank account", map[string]any{"accountIds": []any{""}, "statementDay": 15.0, "budget": 800.0}, true},
		{"missing statement day", map[string]any{"accountIds": []any{"prime_card"}, "budget": 800.0}, true},
		{"statement day zero", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 0.0, "budget": 800.0}, true},
		{"statement day 29", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 29.0, "budget": 800.0}, true},
		{"statement day fractional", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.5, "budget": 800.0}, true},
		{"statement day string", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": "15", "budget": 800.0}, true},
		{"missing budget", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.0}, true},
		{"negative budget", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.0, "budget": -1.0}, true},
		{"non-numeric budget", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.0, "budget": "800"}, true},
		{"nan budget", map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.0, "budget": math.NaN()}, true},
		{"not an object", "prime_card", true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := ValidateCycleFulfillmentConfig(testCase.config)
			if testCase.wantErr && err == nil {
				t.Fatalf("expected an error, got nil")
			}
			if !testCase.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

func TestParseCycleFulfillmentConfig(t *testing.T) {
	parsed, err := ParseCycleFulfillmentConfig(map[string]any{"accountIds": []any{"prime_card", "prime_card", "ultimate_card"}, "statementDay": 15.0, "budget": 800.0})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(parsed.AccountIDs) != 2 || parsed.AccountIDs[0] != "prime_card" || parsed.AccountIDs[1] != "ultimate_card" || parsed.StatementDay != 15 || parsed.Budget != 800 {
		t.Fatalf("parsed = %+v", parsed)
	}
}

// A cycle evaluation pointing at an account the document does not contain must be
// reported rather than silently evaluating against nothing.
func TestValidateFinancialModelFlagsDanglingCycleFulfillmentEvaluation(t *testing.T) {
	document := &types.FinancialModelDocument{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Enabled: true},
		},
		Checkpoints: []types.Checkpoint{},
		Postings:    []types.Posting{},
		Evaluations: types.EvaluationTables{
			CycleFulfillment: []types.CycleEvaluation{{
				InstanceID: "ghost-cycle",
				Name:       "Ghost",
				Enabled:    true,
				Config:     map[string]any{"accountIds": []any{"does-not-exist"}, "statementDay": 15.0, "budget": 100.0},
			}},
		},
	}
	issues := ValidateFinancialModel(document, nil)
	found := false
	for _, issue := range issues {
		if issue.Code == "evaluation.cycleFulfillment.accountId.invalid" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a dangling account reference issue, got %+v", issues)
	}
}

// A valid cycle evaluation must not raise an account reference issue for its own
// table.
func TestValidateFinancialModelAcceptsLiveCycleFulfillmentEvaluation(t *testing.T) {
	document := &types.FinancialModelDocument{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: "prime_card", Name: "Prime Card", Kind: types.AccountKindDebt, Enabled: true},
		},
		Checkpoints: []types.Checkpoint{},
		Postings:    []types.Posting{},
		Evaluations: types.EvaluationTables{
			CycleFulfillment: []types.CycleEvaluation{{
				InstanceID: "prime-cycle",
				Name:       "Prime cycle",
				Enabled:    true,
				Config:     map[string]any{"accountIds": []any{"prime_card"}, "statementDay": 15.0, "budget": 800.0},
			}},
		},
	}
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "evaluation.cycleFulfillment.accountId.invalid" || issue.Code == "evaluation.config.invalid" {
			t.Fatalf("unexpected cycle issue: %+v", issue)
		}
	}
}

func TestResolveStatementCycleAnchors(t *testing.T) {
	start, exclusive := resolveStatementCycle("2026-09-20", 15)
	if start != "2026-09-15" || exclusive != "2026-10-15" {
		t.Fatalf("got %s/%s", start, exclusive)
	}
	start, exclusive = resolveStatementCycle("2026-09-10", 15)
	if start != "2026-08-15" || exclusive != "2026-09-15" {
		t.Fatalf("got %s/%s", start, exclusive)
	}
}

func TestEvaluateCycleFulfillmentSumsRecordedAndScheduled(t *testing.T) {
	card := "prime_card"
	postings := []types.Posting{{
		ID: "charge-sep-16", Name: "Groceries", SourceAccountID: &card,
		Date: "2026-09-16", Enabled: true,
	}}
	buckets := map[string]map[string]float64{"charge-sep-16": {"2026": 60}}
	events := []types.MovementEvent{
		cycleEvent("2026-09-10", "before-window", card, -999, 1),
		cycleEvent("2026-09-22", "charge-sep-22", card, -40, 2),
		cycleEvent("2026-09-23", "payment", card, 200, 3),
		cycleEvent("2026-10-20", "after-window", card, -500, 4),
	}
	path := cyclePath("2026-09-20", postings, events, buckets)
	result := EvaluateCycleFulfillment(path, types.CycleFulfillmentConfig{AccountIDs: []string{card}, StatementDay: 15, Budget: 800})
	if result.CycleStart != "2026-09-15" || result.CycleEnd != "2026-10-14" {
		t.Fatalf("window = %s/%s", result.CycleStart, result.CycleEnd)
	}
	if result.WindowStart != "2026-09-20" {
		t.Fatalf("windowStart = %s", result.WindowStart)
	}
	if result.RecordedSpend != 60 || result.ScheduledSpend != 40 || result.Spent != 100 {
		t.Fatalf("spend = recorded %v scheduled %v total %v", result.RecordedSpend, result.ScheduledSpend, result.Spent)
	}
	if !result.WithinBudget || result.Shortfall != 0 {
		t.Fatalf("expected within budget, got %+v", result)
	}
	if result.DaysLeft != 25 || result.DaysTotal != 30 {
		t.Fatalf("days = left %d total %d", result.DaysLeft, result.DaysTotal)
	}
}

func TestEvaluateCycleFulfillmentCombinesAccountSet(t *testing.T) {
	// One total budget covers both cards: spend sums across the set while
	// payments into either card stay out.
	events := []types.MovementEvent{
		cycleEvent("2026-09-22", "prime-charge", "prime_card", -300, 1),
		cycleEvent("2026-09-23", "ultimate-charge", "ultimate_card", -250, 2),
		cycleEvent("2026-09-24", "payment", "prime_card", 1000, 3),
		cycleEvent("2026-09-25", "other-card", "other_card", -999, 4),
	}
	path := cyclePath("2026-09-20", nil, events, map[string]map[string]float64{})
	result := EvaluateCycleFulfillment(path, types.CycleFulfillmentConfig{AccountIDs: []string{"prime_card", "ultimate_card"}, StatementDay: 15, Budget: 800})
	if result.Spent != 550 {
		t.Fatalf("spent = %v, want 550", result.Spent)
	}
	if !result.WithinBudget {
		t.Fatalf("expected within budget, got %+v", result)
	}
	if len(result.AccountIDs) != 2 {
		t.Fatalf("accountIds = %v", result.AccountIDs)
	}
}

func TestEvaluateCycleFulfillmentSkipsStartDateDoubleCount(t *testing.T) { // A start-date occurrence covered by a movement event (no checkpoint
	// suppression) must count once, through the event.
	card := "prime_card"
	postings := []types.Posting{{
		ID: "charge-start", Name: "Start charge", SourceAccountID: &card,
		Date: "2026-09-20", Enabled: true,
	}}
	buckets := map[string]map[string]float64{"charge-start": {"2026": 25}}
	events := []types.MovementEvent{cycleEvent("2026-09-20", "charge-start", card, -25, 1)}
	path := cyclePath("2026-09-20", postings, events, buckets)
	result := EvaluateCycleFulfillment(path, types.CycleFulfillmentConfig{AccountIDs: []string{card}, StatementDay: 15, Budget: 800})
	if result.Spent != 25 {
		t.Fatalf("spent = %v, want 25", result.Spent)
	}
}

func TestEvaluateCycleFulfillmentReportsShortfall(t *testing.T) {
	card := "prime_card"
	events := []types.MovementEvent{cycleEvent("2026-09-22", "big-charge", card, -900, 1)}
	path := cyclePath("2026-09-20", nil, events, map[string]map[string]float64{})
	result := EvaluateCycleFulfillment(path, types.CycleFulfillmentConfig{AccountIDs: []string{card}, StatementDay: 15, Budget: 800})
	if result.WithinBudget {
		t.Fatalf("expected over budget, got %+v", result)
	}
	if result.Shortfall != 100 || result.Remaining != -100 {
		t.Fatalf("shortfall = %v remaining = %v", result.Shortfall, result.Remaining)
	}
}

func TestCycleFulfillmentDefinitionIsRegistered(t *testing.T) {
	definition, ok := EvaluationRegistryInstance.Get(types.EvaluationTypeCycleFulfillment)
	if !ok {
		t.Fatalf("cycle fulfillment evaluator is not registered")
	}
	if definition.Name == "" {
		t.Fatalf("cycle fulfillment evaluator needs a name")
	}
}

func TestCycleFulfillmentFinalizeReportsProbability(t *testing.T) {
	definition, _ := EvaluationRegistryInstance.Get(types.EvaluationTypeCycleFulfillment)
	acc, err := definition.CreateAccumulator(nil, nil)
	if err != nil {
		t.Fatalf("accumulator: %v", err)
	}
	over := &CycleFulfillmentPathResult{WithinBudget: false, Spent: 900}
	under := &CycleFulfillmentPathResult{WithinBudget: true, Spent: 100}
	if err := definition.Accumulate(acc, over); err != nil {
		t.Fatalf("accumulate: %v", err)
	}
	if err := definition.Accumulate(acc, under); err != nil {
		t.Fatalf("accumulate: %v", err)
	}
	finalized, err := definition.Finalize(acc, nil)
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	finalMap, ok := finalized.(map[string]any)
	if !ok {
		t.Fatalf("finalize returned %T", finalized)
	}
	if probability, _ := finalMap["withinBudgetProbability"].(float64); probability != 0.5 {
		t.Fatalf("probability = %v, want 0.5", probability)
	}
	if _, present := finalMap["spentPercentiles"]; !present {
		t.Fatalf("probabilistic result missing spentPercentiles")
	}
	if status := definition.Status(under, nil); status != types.StatusSatisfied {
		t.Fatalf("deterministic status = %v", status)
	}
	if status := definition.Status(over, nil); status != types.StatusNotSatisfied {
		t.Fatalf("deterministic status = %v", status)
	}
}
