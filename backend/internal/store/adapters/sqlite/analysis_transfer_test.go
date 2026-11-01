package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedTransferLeg(t *testing.T, s *sqliteStore, name, account, bridge, transaction, amount string) string {
	t.Helper()
	seedAccount(t, s, account)
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(bankSeedPosting(name, account, amount, false), SourceSimpleFIN, bridge, transaction),
		{Observe: &BankObservation{
			Keys:  bankKeys(SourceSimpleFIN, bridge, transaction),
			Facts: types.TransactionFacts{Description: name, Amount: amount, Currency: "USD", PostedTime: 1785628800},
		}},
	})
	rows, err := s.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Posting.Name == name {
			return row.Posting.ID
		}
	}
	t.Fatalf("missing leg %q in %+v", name, rows)
	return ""
}

func completeTransferAnalysis(t *testing.T, s *sqliteStore, detections []types.AnalysisDetection) []types.AnalysisFinding {
	t.Helper()
	run, _, claimed, err := s.ClaimAnalysis("transfer", "transfer-v1")
	if err != nil {
		t.Fatalf("claim err=%v", err)
	}
	if claimed {
		if err := s.CompleteAnalysis(run, detections, ""); err != nil {
			t.Fatal(err)
		}
	}
	// An unchanged repeat import claims nothing: findings persist as-is.
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	return findings
}

func TestTransferFindingsPairLegsAndSurviveReruns(t *testing.T) {
	s := openSQLiteStore(t)
	checking := seedTransferLeg(t, s, "CREDIT CARD PAYMENT", "checking", "bridge-checking", "out-1", "-500.00")
	card := seedTransferLeg(t, s, "PAYMENT RECEIVED", "card", "bridge-card", "in-1", "500.00")
	detections := []types.AnalysisDetection{
		{PostingID: checking, Kind: "transfer", Provider: "simplefin", Product: "internal-transfer", Role: "outflow", Strength: "strong", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", PostingIDs: []string{checking, card}}}},
		{PostingID: card, Kind: "transfer", Provider: "simplefin", Product: "internal-transfer", Role: "inflow", Strength: "strong", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", PostingIDs: []string{checking, card}}}},
	}
	first := completeTransferAnalysis(t, s, detections)
	if len(first) != 2 {
		t.Fatalf("findings=%+v", first)
	}
	// A repeated import reruns the same detections without new identities.
	second := completeTransferAnalysis(t, s, detections)
	if len(second) != 2 {
		t.Fatalf("rerun findings=%+v", second)
	}
	byPosting := map[string]types.AnalysisFinding{}
	for _, item := range first {
		byPosting[item.PostingID] = item
	}
	for _, item := range second {
		original, ok := byPosting[item.PostingID]
		if !ok || original.ID != item.ID || original.FirstDetectedAt != item.FirstDetectedAt {
			t.Fatalf("rerun rewrote finding identity: %+v vs %+v", original, item)
		}
	}
	// A user correction persists across detector reruns. New evidence (an
	// updated memo on the same bank keys) schedules a fresh run.
	if err := s.DismissAnalysisFinding(byPosting[checking].ID, true, ""); err != nil {
		t.Fatal(err)
	}
	applyDirectives(t, s, []BankDirective{{Observe: &BankObservation{
		Keys:  bankKeys(SourceSimpleFIN, "bridge-card", "in-1"),
		Facts: types.TransactionFacts{Description: "PAYMENT RECEIVED", Memo: "autopay", Amount: "500.00", Currency: "USD", PostedTime: 1785628800},
	}}})
	third := completeTransferAnalysis(t, s, detections)
	if len(third) != 2 {
		t.Fatalf("rereun findings=%+v", third)
	}
	for _, item := range third {
		if item.PostingID == checking && !item.Dismissed {
			t.Fatalf("dismissal lost: %+v", item)
		}
		if original, ok := byPosting[item.PostingID]; !ok || original.ID != item.ID || original.FirstDetectedAt != item.FirstDetectedAt {
			t.Fatalf("rerun rewrote finding identity: %+v vs %+v", original, item)
		}
	}
}

func TestTransferClaimCoexistsWithBNPLOnOneTransaction(t *testing.T) {
	s := openSQLiteStore(t)
	checking := seedTransferLeg(t, s, "CREDIT CARD PAYMENT", "checking", "bridge-checking", "out-1", "-500.00")
	card := seedTransferLeg(t, s, "PAYMENT RECEIVED", "card", "bridge-card", "in-1", "500.00")
	completeTransferAnalysis(t, s, []types.AnalysisDetection{
		{PostingID: checking, Kind: "transfer", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", PostingIDs: []string{checking, card}}}},
		{PostingID: card, Kind: "transfer", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", PostingIDs: []string{checking, card}}}},
	})
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%+v claimed=%v err=%v", run, claimed, err)
	}
	bnpl := types.AnalysisDetection{PostingID: card, Kind: "bnpl", Provider: "klarna", Strength: "strong", Evidence: []types.AnalysisEvidence{{Code: "bnpl.product-descriptor", PostingIDs: []string{card}}}}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{bnpl}, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{card}})
	if err != nil || len(findings) != 2 {
		t.Fatalf("claims=%+v err=%v", findings, err)
	}
	kinds := map[string]bool{}
	for _, item := range findings {
		kinds[item.PostingID+"\x00"+item.Kind] = true
	}
	if !kinds[card+"\x00transfer"] || !kinds[card+"\x00bnpl"] {
		t.Fatalf("independent claims collided: %+v", findings)
	}
}
