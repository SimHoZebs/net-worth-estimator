package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func finExplainFixture() (*types.FinancialModel, *types.CurrentPosition, types.FinancialHealthReport) {
	model, position := finHealthFixture()
	model.Checkpoints = []types.Checkpoint{
		{AccountID: "checking", Balance: 9000, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
		{AccountID: "card", Balance: -2000, Source: "banksync", ObservedAt: midnightUnix("2026-10-30")},
	}
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	return model, position, report
}

func finExplainActionByID(explanation types.FinancialHealthExplanation, id string) *types.FinancialHealthProposedAction {
	for index := range explanation.Actions {
		if explanation.Actions[index].ID == id {
			return &explanation.Actions[index]
		}
	}
	return nil
}

func TestExplainFinancialHealthCompleteFixture(t *testing.T) {
	model, position, report := finExplainFixture()
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	if explanation.Completeness != types.FinancialHealthComplete {
		t.Fatalf("completeness = %q, want complete", explanation.Completeness)
	}
	if explanation.Sufficiency.Completeness != types.FinancialHealthComplete {
		t.Fatalf("sufficiency completeness = %q, want complete", explanation.Sufficiency.Completeness)
	}
	if !strings.Contains(explanation.Summary, "complete") {
		t.Fatalf("summary must state completeness, got %q", explanation.Summary)
	}
	if len(explanation.Sufficiency.Sources) != 2 {
		t.Fatalf("sources = %d, want one per enabled account", len(explanation.Sufficiency.Sources))
	}
	origins := map[string]string{}
	for _, source := range explanation.Sufficiency.Sources {
		origins[source.AccountID] = source.Origin
		if source.LastObservedAt == nil || source.AgeDays == nil {
			t.Fatalf("%s: fresh observation must carry instant and age", source.AccountID)
		}
		if source.Stale {
			t.Fatalf("%s: day-old observation must not be stale", source.AccountID)
		}
	}
	if origins["checking"] != types.FinancialHealthOriginManual || origins["card"] != types.FinancialHealthOriginSync {
		t.Fatalf("origins = %v, want manual checking and sync card", origins)
	}
	if len(explanation.Sufficiency.Freshness.StaleAccountIDs) != 0 || len(explanation.Sufficiency.Freshness.UnobservedAccountIDs) != 0 {
		t.Fatalf("freshness = %+v, want no stale or unobserved accounts", explanation.Sufficiency.Freshness)
	}
	coverage := explanation.Sufficiency.Coverage
	if coverage.MissingIncome || coverage.MissingOutflow || len(coverage.UnknownLiabilityAccountIDs) != 0 {
		t.Fatalf("coverage = %+v, want no gaps", coverage)
	}
	if coverage.FlowSources[types.FinancialHealthOriginManual] != 6 {
		t.Fatalf("flow sources = %v, want 6 manual window flows", coverage.FlowSources)
	}
	// The fixture carries a balance, so high-interest debt does not meet:
	// its improvement action must link evidence and adjustable targets.
	action := finExplainActionByID(explanation, "improve-high-interest-debt")
	if action == nil {
		t.Fatalf("actions = %v, want an improvement action for the not-meeting check", explanation.Actions)
	}
	if len(action.CheckIDs) != 1 || action.CheckIDs[0] != types.FinancialHealthCheckHighInterestDebt {
		t.Fatalf("check IDs = %v, want the linked check", action.CheckIDs)
	}
	if len(action.Evidence) == 0 || len(action.Targets) == 0 {
		t.Fatalf("improvement action must link evidence and targets, got %+v", action)
	}
}

func TestExplainFinancialHealthMissingIncome(t *testing.T) {
	model, position := finHealthFixture()
	checking := "checking"
	model.Postings = []types.Posting{
		finHealthLiteralPosting("rent-aug", "Rent", &checking, nil, "1500", "2026-08-05"),
		finHealthLiteralPosting("rent-sep", "Rent", &checking, nil, "1500", "2026-09-05"),
		finHealthLiteralPosting("rent-oct", "Rent", &checking, nil, "1500", "2026-10-05"),
	}
	model.Checkpoints = []types.Checkpoint{
		{AccountID: "checking", Balance: 9000, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
		{AccountID: "card", Balance: -2000, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
	}
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	if explanation.Completeness != types.FinancialHealthIncomplete {
		t.Fatalf("completeness = %q, want incomplete without income", explanation.Completeness)
	}
	if !explanation.Sufficiency.Coverage.MissingIncome {
		t.Fatalf("coverage = %+v, want missing income flagged", explanation.Sufficiency.Coverage)
	}
	if !strings.Contains(explanation.Summary, "incomplete") {
		t.Fatalf("summary must state incompleteness, got %q", explanation.Summary)
	}
	action := finExplainActionByID(explanation, "record-missing-income")
	if action == nil {
		t.Fatalf("actions miss record-missing-income: %+v", explanation.Actions)
	}
	for _, checkID := range []string{types.FinancialHealthCheckCashFlowSustainability, types.FinancialHealthCheckSavingsRate} {
		found := false
		for _, linked := range action.CheckIDs {
			if linked == checkID {
				found = true
			}
		}
		if !found {
			t.Fatalf("record-missing-income checks = %v, want %s linked", action.CheckIDs, checkID)
		}
	}
	if len(action.Evidence) == 0 {
		t.Fatalf("record-missing-income must link check evidence")
	}
	if _, ok := action.Targets["lookbackDays"]; !ok {
		t.Fatalf("record-missing-income targets = %v, want the adjustable lookback", action.Targets)
	}
}

func TestExplainFinancialHealthUnknownLiabilities(t *testing.T) {
	model, position, _ := finExplainFixture()
	model.PaymentTerms = nil
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	coverage := explanation.Sufficiency.Coverage
	if len(coverage.UnknownLiabilityAccountIDs) != 1 || coverage.UnknownLiabilityAccountIDs[0] != "card" {
		t.Fatalf("unknown liabilities = %v, want [card]", coverage.UnknownLiabilityAccountIDs)
	}
	if explanation.Completeness != types.FinancialHealthIncomplete {
		t.Fatalf("completeness = %q, want incomplete with unknown liabilities", explanation.Completeness)
	}
	action := finExplainActionByID(explanation, "clarify-liabilities")
	if action == nil {
		t.Fatalf("actions miss clarify-liabilities: %+v", explanation.Actions)
	}
	if !strings.Contains(action.Detail, "Card") {
		t.Fatalf("clarify-liabilities must name the account, got %q", action.Detail)
	}
	if len(action.Evidence) == 0 || len(action.Targets) == 0 {
		t.Fatalf("clarify-liabilities must link evidence and debt targets, got %+v", action)
	}
}

func TestExplainFinancialHealthPaidOffDebtNeedsNoTerms(t *testing.T) {
	model, position, _ := finExplainFixture()
	model.PaymentTerms = nil
	position.Accounts = []types.PositionAccount{
		{AccountID: "checking", Balance: 9000},
		{AccountID: "card", Balance: 0},
	}
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	if len(explanation.Sufficiency.Coverage.UnknownLiabilityAccountIDs) != 0 {
		t.Fatalf("unknown liabilities = %v, want none for paid-off debt without terms", explanation.Sufficiency.Coverage.UnknownLiabilityAccountIDs)
	}
	if finExplainActionByID(explanation, "clarify-liabilities") != nil {
		t.Fatalf("paid-off debt must not propose clarify-liabilities: %+v", explanation.Actions)
	}
}

func TestExplainFinancialHealthStaleSync(t *testing.T) {
	model, position, _ := finExplainFixture()
	model.Checkpoints = []types.Checkpoint{
		{AccountID: "checking", Balance: 9000, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
		{AccountID: "card", Balance: -2000, Source: "banksync", ObservedAt: midnightUnix("2026-08-01")},
	}
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	freshness := explanation.Sufficiency.Freshness
	if len(freshness.StaleAccountIDs) != 1 || freshness.StaleAccountIDs[0] != "card" {
		t.Fatalf("stale = %v, want [card]", freshness.StaleAccountIDs)
	}
	if freshness.StaleAfterDays != 14 {
		t.Fatalf("staleAfterDays = %d, want the default guideline echoed", freshness.StaleAfterDays)
	}
	if explanation.Completeness != types.FinancialHealthIncomplete {
		t.Fatalf("completeness = %q, want incomplete with a stale balance", explanation.Completeness)
	}
	action := finExplainActionByID(explanation, "refresh-stale-sync")
	if action == nil {
		t.Fatalf("actions miss refresh-stale-sync: %+v", explanation.Actions)
	}
	if len(action.Evidence) == 0 {
		t.Fatalf("refresh-stale-sync must link the stale account evidence")
	}
	if action.Targets["staleAfterDays"] != 14 {
		t.Fatalf("refresh-stale-sync targets = %v, want the adjustable recency guideline", action.Targets)
	}
	// A tighter recency guideline still flags the fresh account when it
	// breaks the limit; the guideline stays user-configurable.
	strict := types.FinancialHealthExplanationOptions{StaleAfterDays: 1}
	restated := ExplainFinancialHealth(model, position, report, strict)
	if len(restated.Sufficiency.Freshness.StaleAccountIDs) != 2 {
		t.Fatalf("strict stale = %v, want both accounts past a 1-day guideline", restated.Sufficiency.Freshness.StaleAccountIDs)
	}
}

func TestExplainFinancialHealthPartialIsNotFailure(t *testing.T) {
	model, position := finHealthFixture()
	// Paid-off card: carried balances are zero, so every check can meet.
	position.Accounts = []types.PositionAccount{
		{AccountID: "checking", Balance: 9000},
		{AccountID: "card", Balance: 0},
	}
	// One extra account with no observation: records are visibly partial
	// while every computed verdict still meets its guideline.
	model.Accounts = append(model.Accounts, types.Account{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true})
	model.Checkpoints = []types.Checkpoint{
		{AccountID: "checking", Balance: 9000, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
		{AccountID: "card", Balance: 0, Source: "user", ObservedAt: midnightUnix("2026-10-30")},
	}
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	for _, check := range report.Checks {
		if check.Status != types.FinancialHealthMeeting {
			t.Fatalf("%s = %q, want every check meeting for this fixture", check.CheckID, check.Status)
		}
	}
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	if explanation.Completeness != types.FinancialHealthIncomplete {
		t.Fatalf("completeness = %q, want incomplete despite all checks meeting", explanation.Completeness)
	}
	if !strings.Contains(explanation.Summary, "incomplete") || strings.Contains(explanation.Summary, "fail") {
		t.Fatalf("partial coverage must read as incomplete, never failure, got %q", explanation.Summary)
	}
	if finExplainActionByID(explanation, "observe-accounts") == nil {
		t.Fatalf("actions miss observe-accounts: %+v", explanation.Actions)
	}
}

func TestExplainFinancialHealthInsufficientState(t *testing.T) {
	model, position := finHealthFixture()
	report := EvaluateFinancialHealth(model, position, types.DefaultFinancialHealthStandards())
	for _, testCase := range []struct {
		name     string
		model    *types.FinancialModel
		position *types.CurrentPosition
		report   types.FinancialHealthReport
	}{
		{"nil model", nil, position, report},
		{"nil position", model, nil, report},
		{"missing state report", model, position, EvaluateFinancialHealth(nil, nil, types.DefaultFinancialHealthStandards())},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			explanation := ExplainFinancialHealth(testCase.model, testCase.position, testCase.report, types.DefaultFinancialHealthExplanationOptions())
			if explanation.Completeness != types.FinancialHealthInsufficient {
				t.Fatalf("completeness = %q, want insufficient", explanation.Completeness)
			}
			if len(explanation.Actions) != 1 || explanation.Actions[0].ID != "record-baseline" {
				t.Fatalf("actions = %+v, want only the baseline recording action", explanation.Actions)
			}
		})
	}
}

func TestExplainFinancialHealthActionsLinkEvidenceAndTargets(t *testing.T) {
	model, position, report := finExplainFixture()
	explanation := ExplainFinancialHealth(model, position, report, types.DefaultFinancialHealthExplanationOptions())
	if len(explanation.Actions) == 0 {
		t.Fatalf("complete records with a not-meeting check must still propose actions")
	}
	thresholds := map[string]map[string]float64{}
	for _, check := range report.Checks {
		thresholds[check.CheckID] = check.Threshold
	}
	for _, action := range explanation.Actions {
		if len(action.CheckIDs) == 0 {
			t.Fatalf("%s: action must link its checks", action.ID)
		}
		if len(action.Evidence) == 0 {
			t.Fatalf("%s: action must link evidence", action.ID)
		}
		if len(action.Targets) == 0 {
			t.Fatalf("%s: action must link user-configurable targets", action.ID)
		}
		if strings.HasPrefix(action.ID, "improve-") {
			checkID := action.CheckIDs[0]
			for key := range thresholds[checkID] {
				if _, ok := action.Targets[key]; !ok {
					t.Fatalf("%s: targets %v must echo the %s thresholds %v", action.ID, action.Targets, checkID, thresholds[checkID])
				}
			}
		}
	}
}

func TestComposeFinancialHealthDetailBundlesReportAndExplanation(t *testing.T) {
	model, position, _ := finExplainFixture()
	standards := types.DefaultFinancialHealthStandards()
	options := types.DefaultFinancialHealthExplanationOptions()
	detail := ComposeFinancialHealthDetail(model, position, standards, options)
	wantReport := EvaluateFinancialHealth(model, position, standards)
	if !reflect.DeepEqual(detail.Report, wantReport) {
		t.Fatalf("detail report differs from the evaluation reader output")
	}
	wantExplanation := ExplainFinancialHealth(model, position, wantReport, options)
	if !reflect.DeepEqual(detail.Explanation, wantExplanation) {
		t.Fatalf("detail explanation differs from the direct ExplainFinancialHealth output")
	}
	if detail.Explanation.AsOfDate != detail.Report.AsOfDate {
		t.Fatalf("detail cut = %q, want the report cut %q", detail.Explanation.AsOfDate, detail.Report.AsOfDate)
	}
}

func finExplainSnapshot(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return string(encoded)
}

// TestExplainFinancialHealthReaderOnly pins the reader-only constraint:
// the explain path consumes the evaluation reader inputs only, mutates
// none of them (never writes), and recomposes deterministically without
// simulator state.
func TestExplainFinancialHealthReaderOnly(t *testing.T) {
	model, position, _ := finExplainFixture()
	standards := types.DefaultFinancialHealthStandards()
	options := types.DefaultFinancialHealthExplanationOptions()
	report := EvaluateFinancialHealth(model, position, standards)
	beforeModel, beforePosition, beforeReport := finExplainSnapshot(t, model), finExplainSnapshot(t, position), finExplainSnapshot(t, report)

	first := ComposeFinancialHealthDetail(model, position, standards, options)
	ExplainFinancialHealth(model, position, report, options)

	if got := finExplainSnapshot(t, model); got != beforeModel {
		t.Fatalf("explain path mutated the model")
	}
	if got := finExplainSnapshot(t, position); got != beforePosition {
		t.Fatalf("explain path mutated the position")
	}
	if got := finExplainSnapshot(t, report); got != beforeReport {
		t.Fatalf("explain path mutated the report")
	}
	second := ComposeFinancialHealthDetail(model, position, standards, options)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("explain path is not a pure recomposition of its reader inputs")
	}
}
