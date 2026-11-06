package sqlite

import (
	"errors"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func completeRecurringAnalysis(t *testing.T, s *sqliteStore, version string) types.AnalysisFinding {
	t.Helper()
	transactionID := seedAnalysisEvidence(t, s)
	run, input, claimed, err := s.ClaimAnalysis("recurring", version)
	if err != nil || !claimed || len(input.Transactions) != 1 {
		t.Fatalf("claim=%v input=%+v claimed=%v err=%v", claimed, input, claimed, err)
	}
	detection := types.AnalysisDetection{TransactionID: transactionID, Kind: "recurring", Provider: "klarna", Product: "monthly", Strength: "moderate", Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test pattern", TransactionIDs: []string{transactionID}}}}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	return findings[0]
}

func recurringSourceFacts(t *testing.T, s *sqliteStore, transactionID string) string {
	t.Helper()
	var raw string
	if err := s.db.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE transaction_id = ?`, transactionID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRecurringFindingsAcceptOwnerCorrections(t *testing.T) {
	s := openSQLiteStore(t)
	finding := completeRecurringAnalysis(t, s, "v1")
	beforeModel, _ := s.LoadModel()
	beforeFacts := recurringSourceFacts(t, s, finding.TransactionID)
	confirmed, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "confirm"))
	if err != nil || confirmed.Review == nil || confirmed.Review.Decision != "confirmed" || confirmed.Review.Provider != "klarna" {
		t.Fatalf("confirm=%+v err=%v", confirmed, err)
	}
	// Plan duration stays BNPL-specific; it never corrects a recurrence claim.
	duration := feedbackInput(t, onlyFinding(t, s), "set-duration")
	duration.Duration = &types.AnalysisDuration{Count: 4, Unit: "weeks"}
	if _, err := s.ReviewAnalysisFinding(finding.ID, duration); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
		t.Fatalf("recurring duration=%v", err)
	}
	if _, err := s.ReviewAnalysisFinding(onlyFinding(t, s).ID, feedbackInput(t, onlyFinding(t, s), "reject")); err != nil {
		t.Fatalf("reject=%v", err)
	}
	if next := onlyFinding(t, s); next.Review.Decision != "rejected" || !next.Dismissed {
		t.Fatalf("rejection=%+v", next)
	}
	afterModel, _ := s.LoadModel()
	if !reflect.DeepEqual(beforeModel, afterModel) {
		t.Fatal("owner correction changed the financial model")
	}
	if afterFacts := recurringSourceFacts(t, s, finding.TransactionID); afterFacts != beforeFacts {
		t.Fatal("owner correction overwrote immutable source facts")
	}
}

func TestRecurringCorrectionsRejectPendingEvidence(t *testing.T) {
	s := openSQLiteStore(t)
	finding := completeRecurringAnalysis(t, s, "v1")
	if _, err := s.db.Exec(`UPDATE transactions SET pending=1 WHERE id=? AND user_id=:user_id`, finding.TransactionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "confirm")); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
		t.Fatalf("pending confirm=%v", err)
	}
}
