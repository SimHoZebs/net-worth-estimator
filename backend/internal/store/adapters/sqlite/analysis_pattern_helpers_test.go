package sqlite

import (
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// seedPatternFindings builds the shared three-observation world for pattern
// tests: three monthly bank rows plus one claim/complete cycle. It replaces
// the former seedRecurringEvidence/seedPaymentEvidence and
// completePatternAnalysis/completePaymentAnalysis pair so sqlite has one
// parameterized seed (kind, cadence, description, amount, provider, role).
func seedPatternFindings(t *testing.T, s *sqliteStore, kind, cadence, description, amount, provider, role string) []types.AnalysisFinding {
	t.Helper()
	seedAccount(t, s, "checking")
	stamps := []time.Time{
		time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC),
	}
	ids := []string{}
	for i, stamp := range stamps {
		transaction := bankSeedTransaction(description, "checking", amount, false)
		transaction.PostedTime = stamp.Unix()
		transaction.TransactionTime = stamp.Unix()
		key := "pattern-" + string(rune('a'+i))
		keys := bankKeys(ProviderSimpleFIN, "bank", key)
		applyDirectives(t, s, []BankDirective{
			bankUpsertDirective(transaction, ProviderSimpleFIN, "bank", key),
			{Observe: &BankObservation{Keys: keys, Facts: types.TransactionFacts{Description: description, Amount: amount, Currency: "USD", PostedTime: stamp.Unix(), OccurredAt: stamp.Unix()}}},
		})
		rows, err := s.LoadBankTransactions()
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, rows[len(rows)-1].Transaction.ID)
	}
	analyzer := "payments"
	if kind == "recurring" {
		analyzer = "recurring"
	}
	run, _, claimed, err := s.ClaimAnalysis(analyzer, "pattern-test-v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	typical := strings.TrimPrefix(amount, "-")
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{
			TransactionID: id, Kind: kind, Provider: provider, Product: cadence, Role: role, Strength: "moderate",
			Evidence:      []types.AnalysisEvidence{{Code: kind + ".cadence", Reason: "test pattern", TransactionIDs: ids}},
			Pattern:       &types.AnalysisPaymentPattern{PatternID: "pattern-" + kind, Currency: "USD", TypicalAmount: typical},
			JudgmentInput: &types.AnalysisJudgmentInput{ID: "request-" + kind, Kind: kind, PatternID: "pattern-" + kind},
		})
	}
	if err := s.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != len(ids) {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	return findings
}

func confirmFinding(t *testing.T, s *sqliteStore, finding types.AnalysisFinding) types.AnalysisFinding {
	t.Helper()
	confirmed, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "confirm"))
	if err != nil || confirmed.Review == nil || confirmed.Review.Decision != "confirmed" {
		t.Fatalf("confirm=%+v err=%v", confirmed, err)
	}
	items, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == finding.ID {
			return item
		}
	}
	t.Fatalf("confirmed finding %s vanished", finding.ID)
	return types.AnalysisFinding{}
}
