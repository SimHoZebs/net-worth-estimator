package sqlite

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedPublishBank(t *testing.T, s *sqliteStore, key, description, amount string, stamp int64) string {
	t.Helper()
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(bankSeedTransaction("seed", "checking", amount, false), ProviderSimpleFIN, "bank", key),
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bank", key), Facts: types.TransactionFacts{Description: description, Amount: amount, Currency: "USD", PostedTime: stamp, OccurredAt: stamp}}},
	})
	rows, err := s.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	return rows[len(rows)-1].Transaction.ID
}

func publishDetection(streamID, txID, kind, reason string) types.AnalysisDetection {
	return types.AnalysisDetection{
		StreamID: streamID, TransactionID: txID, Kind: kind, Provider: "acme",
		Product: "monthly", Role: "inflow", Strength: "strong",
		Evidence:      []types.AnalysisEvidence{{Code: kind + ".inflow:annualized", Reason: reason, TransactionIDs: []string{txID}}},
		JudgmentInput: &types.AnalysisJudgmentInput{ID: "req-" + streamID, Kind: kind, PatternID: "pat-" + streamID},
		Judgment:      &types.AnalysisJudgment{RequestID: "req-" + streamID, Status: "ready", Decision: "supported", Strength: "strong"},
		Pattern:       &types.AnalysisPaymentPattern{PatternID: "pat-" + streamID, Currency: "USD", TypicalAmount: "2000.00", AnnualizedEstimate: "24000.00"},
	}
}

func publishStreamEntry(streamID string, members []string, revision int64) store.AnalysisPaymentStream {
	return store.AnalysisPaymentStream{
		StreamID:             streamID,
		StatsJSON:            `{"merchant":"acme","direction":"inflow","currency":"USD"}`,
		MemberTransactionIDs: members,
		ConsumedRevision:     revision,
		IdentityVersion:      1,
	}
}

func activeFindingsByTx(t *testing.T, s *sqliteStore) map[string]types.AnalysisFinding {
	t.Helper()
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]types.AnalysisFinding{}
	for _, finding := range findings {
		if finding.Status == "active" {
			out[finding.TransactionID] = finding
		}
	}
	return out
}

func TestCompleteAnalysisPaymentStreamsScopesWithdrawal(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	stamp := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC).Unix()
	a1 := seedPublishBank(t, s, "a1", "ACME PAYROLL", "2000.00", stamp)
	a2 := seedPublishBank(t, s, "a2", "ACME PAYROLL", "2000.00", stamp+86400*30)
	a3 := seedPublishBank(t, s, "a3", "ACME PAYROLL", "2000.00", stamp+86400*60)
	b1 := seedPublishBank(t, s, "b1", "ACME BONUS", "500.00", stamp)
	c1 := seedPublishBank(t, s, "c1", "ACME DUES", "-50.00", stamp)
	run1, _, claimed, err := s.ClaimAnalysis("payments", "payments-incr-v1")
	if err != nil || !claimed {
		t.Fatalf("claim1=%v err=%v", claimed, err)
	}
	first := []types.AnalysisDetection{
		publishDetection("s1", a1, "income", "first s1"),
		publishDetection("s1", a2, "income", "first s1"),
		publishDetection("s1", a3, "income", "first s1"),
		publishDetection("s2", b1, "income", "first s2"),
		publishDetection("s3", c1, "rent", "first s3"),
	}
	if err := s.CompleteAnalysisPaymentStreams(run1, store.AnalysisPaymentPublish{
		Findings:            first,
		RecomputedStreamIDs: []string{"s1", "s2", "s3"},
		UpsertStreams: []store.AnalysisPaymentStream{
			publishStreamEntry("s1", []string{a1, a2, a3}, run1.InputRevision),
			publishStreamEntry("s2", []string{b1}, run1.InputRevision),
			publishStreamEntry("s3", []string{c1}, run1.InputRevision),
		},
	}); err != nil {
		t.Fatal(err)
	}
	if got := activeFindingsByTx(t, s); len(got) != 5 {
		t.Fatalf("active=%d", len(got))
	}
	// Review and dismissal must survive the next per-stream publish.
	confirmed := confirmFinding(t, s, activeFindingsByTx(t, s)[b1])
	if confirmed.Review == nil {
		t.Fatal("confirm lost")
	}
	dismissedID := activeFindingsByTx(t, s)[a1].ID
	if err := s.DismissAnalysisFinding(dismissedID, true, "tester"); err != nil {
		t.Fatal(err)
	}
	beforeS2, err := json.Marshal(activeFindingsByTx(t, s)[b1].AnalysisDetection)
	if err != nil {
		t.Fatal(err)
	}
	run2, _, claimed, err := s.ClaimAnalysis("payments", "payments-incr-v2")
	if err != nil || !claimed {
		t.Fatalf("claim2=%v err=%v", claimed, err)
	}
	second := []types.AnalysisDetection{
		publishDetection("s1", a1, "income", "second s1"),
		publishDetection("s1", a2, "income", "second s1"),
		publishDetection("s1", a3, "income", "second s1"),
		// s2 carries forward with identical bytes; s3 vanishes.
		activeFindingsByTx(t, s)[b1].AnalysisDetection,
	}
	if err := s.CompleteAnalysisPaymentStreams(run2, store.AnalysisPaymentPublish{
		Findings:            second,
		RecomputedStreamIDs: []string{"s1", "s3"},
		UpsertStreams: []store.AnalysisPaymentStream{
			publishStreamEntry("s1", []string{a1, a2, a3}, run1.InputRevision),
		},
		DeleteStreamIDs: []string{"s3"},
	}); err != nil {
		t.Fatal(err)
	}
	after := activeFindingsByTx(t, s)
	if len(after) != 4 {
		t.Fatalf("active=%d, want 4", len(after))
	}
	// Recomputed stream reconciles with dismissal preserved.
	if after[a1].Evidence[0].Reason != "second s1" || !after[a1].Dismissed || after[a1].RunID != run2.ID {
		t.Fatalf("s1=%+v", after[a1])
	}
	// Untouched stream keeps identical detection bytes and its review while
	// re-attributing to the new run.
	afterS2, err := json.Marshal(after[b1].AnalysisDetection)
	if err != nil {
		t.Fatal(err)
	}
	if string(afterS2) != string(beforeS2) {
		t.Fatalf("s2 detection changed:\nbefore %s\nafter  %s", beforeS2, afterS2)
	}
	if after[b1].Review == nil || after[b1].Review.Decision != "confirmed" || after[b1].RunID != run2.ID {
		t.Fatalf("s2=%+v", after[b1])
	}
	// Vanished stream withdraws.
	all, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	withdrawn := 0
	for _, finding := range all {
		if finding.TransactionID == c1 {
			if finding.Status != "withdrawn" {
				t.Fatalf("s3=%+v", finding)
			}
			withdrawn++
		}
		if finding.TransactionID == b1 && finding.Status != "active" {
			t.Fatalf("s2=%+v", finding)
		}
	}
	if withdrawn != 1 {
		t.Fatalf("withdrawn=%d", withdrawn)
	}
	// Stream cache upserts, deletes, and advances every consumed revision.
	gotS1, err := s.GetAnalysisPaymentStream("s1")
	if err != nil || gotS1.ConsumedRevision != run2.InputRevision {
		t.Fatalf("s1=%+v err=%v", gotS1, err)
	}
	gotS2, err := s.GetAnalysisPaymentStream("s2")
	if err != nil || gotS2.ConsumedRevision != run2.InputRevision {
		t.Fatalf("s2=%+v err=%v", gotS2, err)
	}
	if _, err := s.GetAnalysisPaymentStream("s3"); !store.IsNotFound(err) {
		t.Fatalf("s3=%v", err)
	}
	runs, _, err := s.ListAnalysisRuns()
	if err != nil {
		t.Fatal(err)
	}
	for _, run := range runs {
		if run.Type == "payments" && (run.State != "succeeded" || run.ID != run2.ID) {
			t.Fatalf("runs=%+v", runs)
		}
	}
}
