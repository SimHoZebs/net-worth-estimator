package analysis_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func rentTransactions(description string) []types.AnalysisTransaction {
	var items []types.AnalysisTransaction
	for i, month := range []int{1, 2, 3} {
		items = append(items, incomeTx(fmt.Sprintf("rent-%d", i), description, "-1800.00", incomeDay(2026, time.Month(month), 2)))
	}
	return items
}

func TestRentUsesSharedStreamsAndEvidence(t *testing.T) {
	for _, tc := range []struct {
		text, strength string
		count          int
	}{
		{"BILT RENT", "strong", 3}, {"BILT", "moderate", 3},
		{"RentCafe", "moderate", 3}, {"CLICKPAY", "moderate", 3}, {"Zego", "moderate", 3},
		{"AppFolio", "moderate", 3}, {"FolioSpace", "moderate", 3}, {"Buildium", "moderate", 3},
		{"Zillow", "moderate", 3}, {"Avail", "moderate", 3},
		{"BILT MORTGAGE", "", 0}, {"BILT CARD PAYMENT", "", 0},
		{"CLICKPAY UTILITIES", "", 0}, {"Zego HOA", "", 0}, {"BILT REFUND", "", 0},
		{"unrelated merchant", "", 0}, {"rebilt furniture", "", 0},
	} {
		t.Run(tc.text, func(t *testing.T) {
			items := rentTransactions(tc.text)
			findings, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: items})
			if err != nil || len(findings) != tc.count {
				t.Fatalf("findings=%+v err=%v", findings, err)
			}
			for _, f := range findings {
				if f.Kind != "rent" || f.Role != "outflow" || f.Strength != tc.strength || f.Product != "monthly" || f.Pattern.TypicalAmount != "1800.00" || f.Pattern.AnnualizedEstimate != "21600.00" || f.JudgmentInput.Kind != "rent" {
					t.Fatalf("finding=%+v", f)
				}
			}
		})
	}
}

func TestClassificationDecisionIsIndependentOfOperationalStatus(t *testing.T) {
	for _, decision := range []string{"supported", "unsupported", "uncertain"} {
		t.Run(decision, func(t *testing.T) {
			detector := analysis.PaymentPatterns{Judge: incomeEvaluator(func(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
				return []types.AnalysisJudgment{{RequestID: requests[0].ID, Status: "ready", Decision: decision, Strength: "moderate"}}, nil
			})}
			f, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions("BILT")})
			if err != nil || len(f) != 3 || f[0].Judgment.Decision != decision || !strings.Contains(f[0].Evidence[0].Reason, decision) {
				t.Fatalf("findings=%+v err=%v", f, err)
			}
		})
	}
	detector := analysis.PaymentPatterns{Judge: incomeEvaluator(func(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
		return []types.AnalysisJudgment{{RequestID: requests[0].ID, Status: "pending"}}, nil
	})}
	f, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions("BILT RENT")})
	if !errors.Is(err, judgment.ErrPending) || len(f) != 3 || f[0].Strength != "strong" {
		t.Fatalf("fallback=%+v err=%v", f, err)
	}
}

func TestSiblingClassificationsNeedOnlyDefinitions(t *testing.T) {
	definitions := []analysis.PaymentClassification{
		{ID: "utilities", Label: "utilities", Direction: "outflow", SupportSignals: []string{"non-rent-charge"}},
		{ID: "mortgage", Label: "mortgage", Direction: "outflow", SupportSignals: []string{"mortgage-descriptor"}},
	}
	for _, text := range []string{"Zego UTILITIES", "BILT MORTGAGE"} {
		f, err := (analysis.PaymentPatterns{Classifications: definitions}).Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions(text)})
		if err != nil || len(f) != 3 {
			t.Fatalf("sibling=%+v err=%v", f, err)
		}
	}
}

func TestHundredsOfClassificationsUseBoundedSharedBatches(t *testing.T) {
	definitions := make([]analysis.PaymentClassification, 300)
	for i := range definitions {
		definitions[i] = analysis.PaymentClassification{ID: fmt.Sprintf("type-%03d", i), Label: "payment", Direction: "outflow", SupportSignals: []string{"rent-descriptor"}}
	}
	calls := 0
	detector := analysis.PaymentPatterns{Classifications: definitions, Judge: incomeEvaluator(func(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
		calls++
		if len(requests) > 100 {
			t.Fatalf("unbounded batch: %d", len(requests))
		}
		decisions := make([]types.AnalysisJudgment, len(requests))
		for i, r := range requests {
			if len(r.Samples) > 3 {
				t.Fatal("unbounded samples")
			}
			decisions[i] = types.AnalysisJudgment{RequestID: r.ID, Status: "ready", Decision: "supported", Strength: "strong"}
		}
		return decisions, nil
	})}
	f, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions("RENT")})
	if err != nil || len(f) != 900 || calls != 3 {
		t.Fatalf("findings=%d calls=%d err=%v", len(f), calls, err)
	}
	if f[0].JudgmentInput.ID == f[1].JudgmentInput.ID || f[0].Pattern.PatternID != f[1].Pattern.PatternID {
		t.Fatal("classification request and stream identity conflated")
	}
}

func TestClassificationPolicyChangesInvalidateVersionNotStreamIdentity(t *testing.T) {
	definitions := analysis.PaymentClassifications()
	before := analysis.PaymentPatterns{Classifications: definitions}
	a, err := before.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions("BILT RENT")})
	if err != nil {
		t.Fatal(err)
	}
	changed := append([]analysis.PaymentClassification(nil), definitions...)
	changed[1].Label = "housing rent"
	after := analysis.PaymentPatterns{Classifications: changed}
	b, err := after.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: rentTransactions("BILT RENT")})
	if err != nil || len(b) != 3 {
		t.Fatal(err)
	}
	if before.Version() == after.Version() || analysis.MatchesVersion(after, before.Version()) {
		t.Fatal("policy did not invalidate analyzer freshness")
	}
	if a[0].Pattern.PatternID != b[0].Pattern.PatternID || a[0].JudgmentInput.ID == b[0].JudgmentInput.ID {
		t.Fatal("semantic question reidentified the observed stream")
	}
}

func BenchmarkThreeHundredPaymentClassifications(b *testing.B) {
	definitions := make([]analysis.PaymentClassification, 300)
	for i := range definitions {
		definitions[i] = analysis.PaymentClassification{ID: fmt.Sprintf("type-%03d", i), Label: "payment", Direction: "outflow", SupportSignals: []string{"rent-descriptor"}}
	}
	detector := analysis.PaymentPatterns{Classifications: definitions}
	input := types.AnalysisSnapshot{UserID: "benchmark", Transactions: rentTransactions("RENT")}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		f, err := detector.Analyze(context.Background(), input)
		if err != nil || len(f) != 900 {
			b.Fatalf("findings=%d err=%v", len(f), err)
		}
	}
}
