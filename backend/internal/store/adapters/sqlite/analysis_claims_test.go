package sqlite

import (
	"errors"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// completeClaim publishes one finding for an independent analysis type. The
// stub producer stands in for the future recurring, transfer, and receipt
// producers owned by FIN-01, VIS-03, and INT-03; its names are test-only and
// set no production vocabulary.
func completeClaim(t *testing.T, s *sqliteStore, analysisType, version, kind, postingID string) types.AnalysisFinding {
	t.Helper()
	run, _, claimed, err := s.ClaimAnalysis(analysisType, version)
	if err != nil || !claimed {
		t.Fatalf("claim %s=%v %v", analysisType, claimed, err)
	}
	detection := types.AnalysisDetection{
		PostingID: postingID,
		Kind:      kind,
		Provider:  "stub-provider",
		Strength:  "moderate",
		Evidence:  []types.AnalysisEvidence{{Code: "stub.independent-claim", Reason: "A second independent producer observed the same transaction.", PostingIDs: []string{postingID}}},
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	items, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{postingID}})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.AnalysisType == analysisType && item.Kind == kind {
			return item
		}
	}
	t.Fatalf("missing %s/%s in %+v", analysisType, kind, items)
	return types.AnalysisFinding{}
}

func sourceFactsJSON(t *testing.T, s *sqliteStore, postingID string) string {
	t.Helper()
	var raw string
	if err := s.db.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE posting_id = ?`, postingID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestIndependentClaimsCoexistForOneTransaction(t *testing.T) {
	s := openSQLiteStore(t)
	postingID := seedAnalysisEvidence(t, s)
	bnpl := completeClaim(t, s, "bnpl", "v1", "bnpl", postingID)
	other := completeClaim(t, s, "stub-claims", "v1", "stub-claim", postingID)
	if bnpl.PostingID != postingID || other.PostingID != postingID {
		t.Fatalf("claims split across transactions: %+v %+v", bnpl, other)
	}
	items, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{postingID}})
	if err != nil || len(items) != 2 {
		t.Fatalf("coexist=%+v err=%v", items, err)
	}
	for _, item := range items {
		if item.Status != "active" || item.Stale {
			t.Fatalf("claim not active: %+v", item)
		}
		if len(item.Evidence) == 0 {
			t.Fatalf("claim without supporting evidence: %+v", item)
		}
	}
	// Withdrawing one producer's claim leaves the independent claim active,
	// and both remain visible for review.
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v2")
	if err != nil || !claimed {
		t.Fatalf("withdraw claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	items, err = s.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{postingID}})
	if err != nil || len(items) != 2 {
		t.Fatalf("conflicting claims hidden: %+v %v", items, err)
	}
	for _, item := range items {
		switch item.AnalysisType {
		case "bnpl":
			if item.Status != "withdrawn" {
				t.Fatalf("bnpl=%+v", item)
			}
		case "stub-claims":
			if item.Status != "active" || item.Stale {
				t.Fatalf("independent claim disturbed: %+v", item)
			}
		default:
			t.Fatalf("unexpected producer: %+v", item)
		}
	}
}

func TestOwnerCorrectionsApplyToAnyClaimKindWithoutTouchingSourceFacts(t *testing.T) {
	s := openSQLiteStore(t)
	postingID := seedAnalysisEvidence(t, s)
	completeClaim(t, s, "bnpl", "v1", "bnpl", postingID)
	other := completeClaim(t, s, "stub-claims", "v1", "stub-claim", postingID)
	beforeModel, _ := s.LoadModel()
	beforeFacts := sourceFactsJSON(t, s, postingID)
	confirmed, err := s.ReviewAnalysisFinding(other.ID, feedbackInput(t, other, "confirm"))
	if err != nil || confirmed.Review == nil || confirmed.Review.Decision != "confirmed" {
		t.Fatalf("generic confirm=%+v err=%v", confirmed, err)
	}
	duration := feedbackInput(t, onlyFindingOf(t, s, other.ID), "set-duration")
	duration.Duration = &types.AnalysisDuration{Count: 4, Unit: "weeks"}
	if _, err := s.ReviewAnalysisFinding(other.ID, duration); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
		t.Fatalf("non-BNPL duration=%v", err)
	}
	if _, err := s.ReviewAnalysisFinding(other.ID, feedbackInput(t, onlyFindingOf(t, s, other.ID), "reject")); err != nil {
		t.Fatalf("generic reject=%v", err)
	}
	afterModel, _ := s.LoadModel()
	if !reflect.DeepEqual(beforeModel, afterModel) {
		t.Fatal("owner correction changed the financial model")
	}
	if afterFacts := sourceFactsJSON(t, s, postingID); afterFacts != beforeFacts {
		t.Fatal("owner correction overwrote immutable source facts")
	}
}

func onlyFindingOf(t *testing.T, s *sqliteStore, id string) types.AnalysisFinding {
	t.Helper()
	items, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == id {
			return item
		}
	}
	t.Fatalf("finding %s missing in %+v", id, items)
	return types.AnalysisFinding{}
}
