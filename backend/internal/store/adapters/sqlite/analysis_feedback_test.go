package sqlite

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func feedbackInput(t *testing.T, finding types.AnalysisFinding, action string) types.AnalysisFeedbackInput {
	t.Helper()
	id, err := newRowID()
	if err != nil {
		t.Fatal(err)
	}
	return types.AnalysisFeedbackInput{RequestID: id, RunID: finding.RunID, Revision: finding.FeedbackRevision, Action: action, Actor: "verified-owner"}
}

func onlyFinding(t *testing.T, s *sqliteStore) types.AnalysisFinding {
	t.Helper()
	items, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(items) != 1 {
		t.Fatalf("findings=%+v err=%v", items, err)
	}
	return items[0]
}

func TestAnalysisFeedbackAuditReplayAndDuration(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	before, _ := s.LoadModel()
	input := feedbackInput(t, finding, "confirm")
	confirmed, err := s.ReviewAnalysisFinding(finding.ID, input)
	if err != nil || confirmed.Revision != 1 || confirmed.Review.Decision != "confirmed" || confirmed.Actor != "verified-owner" || confirmed.AnalyzerVersion != "v1" || !reflect.DeepEqual(confirmed.Prediction, finding.AnalysisDetection) {
		t.Fatalf("confirm=%+v err=%v", confirmed, err)
	}
	replay, err := s.ReviewAnalysisFinding(finding.ID, input)
	if err != nil || !reflect.DeepEqual(confirmed, replay) {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	changed := input
	changed.Action = "reject"
	if _, err := s.ReviewAnalysisFinding(finding.ID, changed); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
		t.Fatalf("request ID reuse=%v", err)
	}
	changed = input
	changed.Actor = "another-owner"
	if _, err := s.ReviewAnalysisFinding(finding.ID, changed); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
		t.Fatalf("actor reuse=%v", err)
	}
	stale := feedbackInput(t, finding, "reject")
	if _, err := s.ReviewAnalysisFinding(finding.ID, stale); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
		t.Fatalf("stale revision=%v", err)
	}
	finding = onlyFinding(t, s)
	input = feedbackInput(t, finding, "set-duration")
	input.Duration = &types.AnalysisDuration{Count: 6, Unit: "weeks"}
	saved, err := s.ReviewAnalysisFinding(finding.ID, input)
	if err != nil || saved.Revision != 2 || !reflect.DeepEqual(saved.Review.Duration, input.Duration) {
		t.Fatalf("duration=%+v err=%v", saved, err)
	}
	items, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{FindingID: finding.ID, Limit: 1})
	if err != nil || len(items) != 1 || !reflect.DeepEqual(items[0], confirmed) || items[0].Review.Duration != nil {
		t.Fatalf("immutable confirmation=%+v %v", items, err)
	}
	next, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{Cursor: items[0].ID})
	if err != nil || len(next) != 1 || next[0].ID != saved.ID {
		t.Fatalf("cursor=%+v %v", next, err)
	}
	// Replayed confirmation returns its original event, not the later state.
	replay, err = s.ReviewAnalysisFinding(finding.ID, confirmed.Request)
	if err == nil {
		t.Fatal("actor-less replay should not impersonate the verified owner")
	}
	request := confirmed.Request
	request.Actor = confirmed.Actor
	replay, err = s.ReviewAnalysisFinding(finding.ID, request)
	if err != nil || !reflect.DeepEqual(replay, confirmed) || onlyFinding(t, s).Review.Duration.Count != 6 {
		t.Fatalf("old replay changed state: %+v %v", replay, err)
	}
	after, _ := s.LoadModel()
	if !reflect.DeepEqual(before, after) {
		t.Fatal("feedback changed financial model")
	}
}

func TestAnalysisFeedbackValidationAndSourceConflicts(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	for _, duration := range []*types.AnalysisDuration{nil, {Count: 0, Unit: "months"}, {Count: 5201, Unit: "weeks"}, {Count: 2, Unit: "days"}, {Count: 2, Unit: "weeks"}} {
		input := feedbackInput(t, finding, "set-duration")
		input.Duration = duration
		if _, err := s.ReviewAnalysisFinding(finding.ID, input); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
			t.Fatalf("unconfirmed duration=%+v %v", duration, err)
		}
	}
	input := feedbackInput(t, finding, "confirm")
	input.RequestID = "invalid"
	if _, err := s.ReviewAnalysisFinding(finding.ID, input); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
		t.Fatalf("request ID=%v", err)
	}
	input = feedbackInput(t, finding, "confirm")
	input.RunID = "changed"
	if _, err := s.ReviewAnalysisFinding(finding.ID, input); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
		t.Fatalf("run=%v", err)
	}
	for _, column := range []string{"pending", "void"} {
		if _, err := s.db.Exec(`UPDATE postings SET `+column+`=1 WHERE id=? AND user_id=:user_id`, finding.PostingID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "confirm")); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
			t.Fatalf("%s=%v", column, err)
		}
		if _, err := s.db.Exec(`UPDATE postings SET `+column+`=0 WHERE id=? AND user_id=:user_id`, finding.PostingID); err != nil {
			t.Fatal(err)
		}
	}
	applyDirectives(t, s, []BankDirective{{Observe: &BankObservation{Keys: bankKeys(SourceSimpleFIN, "bank", "charge"), Facts: types.TransactionFacts{Description: "KLARNA PAY NOW", Amount: "-25", Currency: "USD"}}}})
	for _, action := range []string{"confirm", "reject"} {
		if _, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, action)); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
			t.Fatalf("stale source=%v", err)
		}
	}
	items, _ := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if len(items) != 0 {
		t.Fatal("invalid feedback was logged")
	}
}

func TestAnalysisFeedbackSurvivesRerunsImportsAndPruning(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	confirmed, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "confirm"))
	if err != nil {
		t.Fatal(err)
	}
	finding = onlyFinding(t, s)
	input := feedbackInput(t, finding, "set-duration")
	input.Duration = &types.AnalysisDuration{Count: 3, Unit: "months"}
	if _, err := s.ReviewAnalysisFinding(finding.ID, input); err != nil {
		t.Fatal(err)
	}
	for i := 2; i < 132; i++ {
		next := completeTestAnalysis(t, s, fmt.Sprintf("v%d", i))
		if next.Review == nil || next.Review.Decision != "confirmed" || next.Review.Duration.Count != 3 || next.FeedbackRevision != 2 {
			t.Fatal("rerun lost review")
		}
	}
	var snapshots int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM analysis_runs WHERE id=? AND user_id=:user_id`, confirmed.RunID).Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatalf("feedback evidence pruned=%d %v", snapshots, err)
	}
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "withdraw")
	if err != nil || !claimed {
		t.Fatalf("withdraw claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	if next := onlyFinding(t, s); next.Status != "withdrawn" || next.Review.Decision != "confirmed" {
		t.Fatal("withdrawal lost confirmation")
	}
	doc, _ := s.LoadModel()
	if _, err := s.ImportModel(doc); err != nil {
		t.Fatal(err)
	}
	if next := onlyFinding(t, s); next.Review.Duration.Count != 3 || next.FeedbackRevision != 2 {
		t.Fatal("import lost review")
	}
	items, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(items) != 2 || !reflect.DeepEqual(items[0], confirmed) {
		t.Fatalf("import audit=%+v %v", items, err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	items, err = s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(items) != 0 {
		t.Fatalf("clear audit=%+v %v", items, err)
	}
}

func TestAnalysisFeedbackRejectionAndGenericVisibility(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	if _, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, "reject")); err != nil {
		t.Fatal(err)
	}
	next := completeTestAnalysis(t, s, "v2")
	if !next.Dismissed || next.Review.Decision != "rejected" {
		t.Fatal("rerun lost rejection")
	}
	if err := s.DismissAnalysisFinding(finding.ID, false, "verified-owner"); err != nil {
		t.Fatal(err)
	}
	next = onlyFinding(t, s)
	if next.Dismissed || next.Review != nil {
		t.Fatal("restore did not reset rejection")
	}
	if _, err := s.ReviewAnalysisFinding(next.ID, feedbackInput(t, next, "confirm")); err != nil {
		t.Fatal(err)
	}
	for _, hidden := range []bool{true, false} {
		if err := s.DismissAnalysisFinding(finding.ID, hidden, "verified-owner"); err != nil {
			t.Fatal(err)
		}
		next = onlyFinding(t, s)
		if next.Dismissed != hidden || next.Review.Decision != "confirmed" {
			t.Fatal("visibility changed explicit answer")
		}
	}
	items, _ := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	var actions []string
	for _, item := range items {
		if item.Actor != "verified-owner" {
			t.Fatalf("visibility actor=%q", item.Actor)
		}
		actions = append(actions, item.Request.Action)
	}
	if !reflect.DeepEqual(actions, []string{"reject", "restore", "confirm", "hide", "restore"}) {
		t.Fatalf("actions=%v", actions)
	}
}

func TestAnalysisFeedbackRejectsWithdrawnUnansweredPrediction(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v2")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"confirm", "reject"} {
		if _, err := s.ReviewAnalysisFinding(finding.ID, feedbackInput(t, finding, action)); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
			t.Fatalf("withdrawn answer=%v", err)
		}
	}
}

func TestAnalysisFeedbackConcurrentAnswersUseOneRevision(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	start, results := make(chan struct{}), make(chan error, 2)
	for _, action := range []string{"confirm", "reject"} {
		input := feedbackInput(t, finding, action)
		go func() {
			<-start
			_, err := s.ReviewAnalysisFinding(finding.ID, input)
			results <- err
		}()
	}
	close(start)
	written, conflicts := 0, 0
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			written++
		case errors.Is(err, store.ErrAnalysisFeedbackConflict):
			conflicts++
		default:
			t.Fatalf("concurrent answer=%v", err)
		}
	}
	if written != 1 || conflicts != 1 || onlyFinding(t, s).FeedbackRevision != 1 {
		t.Fatalf("written=%d conflicts=%d", written, conflicts)
	}
	events, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(events) != 1 {
		t.Fatalf("concurrent history=%+v %v", events, err)
	}
}
