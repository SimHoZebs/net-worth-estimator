package analysis_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func incomeTx(id, description, amount string, stamp int64) types.AnalysisTransaction {
	return types.AnalysisTransaction{
		TransactionID:  id,
		AccountID:      "bank",
		SourceProvider: "simplefin",
		Facts: types.TransactionFacts{
			Description: description,
			Amount:      amount,
			Currency:    "USD",
			PostedTime:  stamp,
			OccurredAt:  stamp,
			Metadata:    map[string]string{},
		},
	}
}

func incomeDay(year int, month time.Month, day int) int64 {
	return time.Date(year, month, day, 12, 0, 0, 0, time.UTC).Unix()
}

func analyzeIncome(t *testing.T, items []types.AnalysisTransaction) []types.AnalysisDetection {
	t.Helper()
	result, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), types.AnalysisSnapshot{UserID: "u1", Transactions: items})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestIncomeDetectsMainPayrollAndAnnualizes(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME PAYROLL DEPT", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
		incomeTx("d", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 13)),
	}
	result := analyzeIncome(t, items)
	if len(result) != 4 {
		t.Fatalf("want 4 got %d: %+v", len(result), result)
	}
	for _, item := range result {
		if item.Kind != "income" || item.Product != "biweekly" || item.Provider != "acme" || item.Role != "inflow" {
			t.Fatalf("detection=%+v", item)
		}
		if item.Strength != "strong" {
			t.Fatalf("payroll should be strong: %+v", item)
		}
		if item.Evidence[0].Code != "income.main-inflow:annualized" {
			t.Fatalf("main code = %q", item.Evidence[0].Code)
		}
		if !strings.Contains(item.Evidence[0].Reason, "52000") {
			t.Fatalf("annualized missing in %q", item.Evidence[0].Reason)
		}
		if item.Pattern == nil || item.Pattern.TypicalAmount != "2000.00" || item.Pattern.AnnualizedEstimate != "52000.00" || item.Pattern.Currency != "USD" || item.Pattern.PatternID != item.JudgmentInput.PatternID {
			t.Fatalf("missing source amount summary: %+v", item.Pattern)
		}
		if !strings.Contains(item.Evidence[0].Reason, "main consistent inflow") {
			t.Fatalf("main phrase missing in %q", item.Evidence[0].Reason)
		}
	}
}

func TestIncomeIgnoresTransferAndRefund(t *testing.T) {
	// Transfer inflow with exact opposite outflow on another account.
	items := []types.AnalysisTransaction{
		incomeTx("in1", "TRANSFER IN", "500.00", incomeDay(2026, 1, 5)),
		incomeTx("in2", "TRANSFER IN", "500.00", incomeDay(2026, 2, 5)),
		incomeTx("in3", "TRANSFER IN", "500.00", incomeDay(2026, 3, 5)),
	}
	items[0].AccountID, items[1].AccountID, items[2].AccountID = "bank", "bank", "bank"
	out := incomeTx("out1", "TRANSFER OUT", "-500.00", incomeDay(2026, 1, 6))
	out.AccountID = "other"
	out2 := incomeTx("out2", "TRANSFER OUT", "-500.00", incomeDay(2026, 2, 6))
	out2.AccountID = "other"
	out3 := incomeTx("out3", "TRANSFER OUT", "-500.00", incomeDay(2026, 3, 6))
	out3.AccountID = "other"
	items = append(items, out, out2, out3)
	if result := analyzeIncome(t, items); len(result) != 0 {
		t.Fatalf("transfer matched as income: %+v", result)
	}

	refunds := []types.AnalysisTransaction{
		incomeTx("a", "REFUND ACME", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "REFUND ACME", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "REFUND ACME", "2000.00", incomeDay(2026, 1, 30)),
	}
	if result := analyzeIncome(t, refunds); len(result) != 0 {
		t.Fatalf("refund as income: %+v", result)
	}
}

func TestIncomeSummaryPreservesUnscaledAmounts(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME PAYROLL", "25000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME PAYROLL", "25000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME PAYROLL", "25000.00", incomeDay(2026, 1, 30)),
	}
	findings := analyzeIncome(t, items)
	if len(findings) != 3 {
		t.Fatalf("findings=%d", len(findings))
	}
	for _, finding := range findings {
		if finding.Pattern.TypicalAmount != "25000.00" || finding.Pattern.AnnualizedEstimate != "650000.00" {
			t.Fatalf("source amounts=%+v", finding.Pattern)
		}
		if finding.JudgmentInput.Pattern.TypicalAmount != "25000.00" || finding.JudgmentInput.Pattern.AnnualizedEstimate != "650000.00" {
			t.Fatal("judgment evidence changed the source amounts")
		}
	}
}

func TestIncomeRanksMainOverSideIncome(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a1", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("a2", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("a3", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
		incomeTx("b1", "FREELANCE CLIENT", "300.00", incomeDay(2026, 1, 5)),
		incomeTx("b2", "FREELANCE CLIENT", "300.00", incomeDay(2026, 2, 5)),
		incomeTx("b3", "FREELANCE CLIENT", "300.00", incomeDay(2026, 3, 5)),
	}
	result := analyzeIncome(t, items)
	if len(result) != 6 {
		t.Fatalf("want 6 got %d", len(result))
	}
	mainCount, sideCount := 0, 0
	for _, item := range result {
		switch item.Evidence[0].Code {
		case "income.main-inflow:annualized":
			mainCount++
			if item.Provider != "acme" {
				t.Fatalf("main should be acme got %+v", item)
			}
		case "income.inflow:annualized":
			sideCount++
		default:
			t.Fatalf("unexpected code %q", item.Evidence[0].Code)
		}
	}
	if mainCount != 3 || sideCount != 3 {
		t.Fatalf("main=%d side=%d", mainCount, sideCount)
	}
}

type incomeEvaluator func(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error)

func (f incomeEvaluator) Evaluate(ctx context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	return f(ctx, requests)
}

func TestIncomeJudgmentDeterminesStrengthWithoutLearning(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
	}
	detector := analysis.PaymentPatterns{Judge: incomeEvaluator(func(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
		if len(requests) != 1 || len(requests[0].Samples) != 3 {
			t.Fatalf("evidence=%+v", requests)
		}
		return []types.AnalysisJudgment{{RequestID: requests[0].ID, Status: "ready", Decision: "uncertain", Strength: "moderate", Reason: "Income is not established."}}, nil
	})}
	result, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "u1", Transactions: items})
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 3 || result[0].Strength != "moderate" {
		t.Fatalf("domain judgment should control strength: %+v", result)
	}
	if !strings.Contains(result[0].Evidence[0].Reason, "Income is not established.") {
		t.Fatalf("missing explanation: %q", result[0].Evidence[0].Reason)
	}
	data, _ := json.Marshal(result)
	if strings.Contains(string(data), "features") || strings.Contains(string(data), "examples_seen") || strings.Contains(string(data), "probability") {
		t.Fatal("engine details leaked into the feature contract")
	}
}

func TestIncomeFallsBackWhenJudgmentUnavailable(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
	}
	detector := analysis.PaymentPatterns{Judge: incomeEvaluator(func(context.Context, []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
		return nil, judgment.ErrUnavailable
	})}
	result, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "u1", Transactions: items})
	if !errors.Is(err, judgment.ErrUnavailable) {
		t.Fatal(err)
	}
	if len(result) != 3 || result[0].Strength != "strong" {
		t.Fatalf("fallback should still detect: %+v", result)
	}
}

func TestIncomePatternIdentityIncludesOwnerAccountAndCurrency(t *testing.T) {
	var items []types.AnalysisTransaction
	for _, account := range []string{"a", "b"} {
		for i, day := range []int{2, 16, 30} {
			tx := incomeTx(account+string(rune('0'+i)), "ACME PAYROLL", "2000", incomeDay(2026, 1, day))
			tx.AccountID = account
			items = append(items, tx)
		}
	}
	first := analyzeIncome(t, items)
	if len(first) != 6 {
		t.Fatalf("findings=%d", len(first))
	}
	if first[0].JudgmentInput.PatternID == first[3].JudgmentInput.PatternID {
		t.Fatal("account patterns collided")
	}
	other, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), types.AnalysisSnapshot{UserID: "other", Transactions: items})
	if err != nil {
		t.Fatal(err)
	}
	if first[0].JudgmentInput.PatternID == other[0].JudgmentInput.PatternID {
		t.Fatal("owner patterns collided")
	}
	for i := 3; i < 6; i++ {
		items[i].Facts.Currency = "EUR"
	}
	changed := analyzeIncome(t, items)
	if first[3].JudgmentInput.PatternID == changed[3].JudgmentInput.PatternID {
		t.Fatal("currency patterns collided")
	}
	for _, finding := range changed {
		if finding.Evidence[0].Code == "income.main-inflow:annualized" {
			t.Fatal("ranked incomparable currencies")
		}
	}
}

func TestIncomeCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (analysis.PaymentPatterns{}).Analyze(ctx, types.AnalysisSnapshot{Transactions: []types.AnalysisTransaction{incomeTx("a", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2))}}); err != context.Canceled {
		t.Fatalf("cancellation=%v", err)
	}
}

func TestIncomeRequestIdentityTracksImmutableEvidence(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
		incomeTx("d", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 13)),
	}
	before := analyzeIncome(t, items)[0].JudgmentInput
	if len(before.Samples) != 3 || before.Pattern.OccurrenceCount != 4 {
		t.Fatal("evidence sampling lost full pattern statistics")
	}
	items[3].Facts.Description = "acme payroll"
	after := analyzeIncome(t, items)[0].JudgmentInput
	if before.PatternID != after.PatternID || before.ID == after.ID {
		t.Fatal("request identity did not distinguish changed evidence from pattern identity")
	}
}
