package sqlite

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternToNewSchedulePreviewDerivesRuleAfterEvidence(t *testing.T) {
	s := openSQLiteStore(t)
	findings := seedPatternFindings(t, s, "recurring", "monthly", "GROCER 123", "-30.00", "grocer", "outflow")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Creatable || preview.Reason != "" || preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Occurrences) != 3 || len(preview.Upcoming) != 6 {
		t.Fatalf("occurrences=%+v upcoming=%+v", preview.Occurrences, preview.Upcoming)
	}
	// The rule starts on the oldest recorded movement and
	// Upcoming stays future-only after the latest recorded movement.
	if preview.Schedule == nil || preview.Schedule.StartDate != "2026-01-15" {
		t.Fatalf("schedule=%+v", preview.Schedule)
	}
	if preview.Upcoming[0].Date != "2026-04-15" || preview.Upcoming[5].Date != "2026-09-15" {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
}

func TestPatternToNewSchedulePreviewGuards(t *testing.T) {
	s := openSQLiteStore(t)
	if _, err := s.PreviewPatternToNewSchedule("missing"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing=%v", err)
	}
	findings := seedPatternFindings(t, s, "recurring", "monthly", "GROCER 123", "-30.00", "grocer", "outflow")
	anchorTx := findings[0].TransactionID
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{{TransactionID: anchorTx, Kind: "bnpl", Provider: "grocer", Strength: "strong"}}, ""); err != nil {
		t.Fatal(err)
	}
	bnpl, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{anchorTx}})
	if err != nil || len(bnpl) != 2 {
		t.Fatalf("findings=%+v err=%v", bnpl, err)
	}
	for _, item := range bnpl {
		if item.Kind == "bnpl" {
			if _, err := s.PreviewPatternToNewSchedule(item.ID); !errors.Is(err, store.ErrPatternToNewScheduleInvalid) {
				t.Fatalf("bnpl=%v", err)
			}
		}
	}
	unconfirmed, err := s.PreviewPatternToNewSchedule(findings[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !unconfirmed.Creatable || unconfirmed.Schedule == nil || unconfirmed.Reason != "" {
		t.Fatalf("unconfirmed=%+v", unconfirmed)
	}
	anchor := confirmFinding(t, s, findings[0])
	if _, err := s.db.Exec(`UPDATE transactions SET void=1 WHERE id=? AND user_id=:user_id`, anchorTx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewPatternToNewSchedule(anchor.ID); !errors.Is(err, store.ErrPatternToNewScheduleConflict) {
		t.Fatalf("voided=%v", err)
	}
}

func TestPatternToNewScheduleTracksOneActiveRule(t *testing.T) {
	s := openSQLiteStore(t)
	findings := seedPatternFindings(t, s, "recurring", "monthly", "GROCER 123", "-30.00", "grocer", "outflow")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || !preview.Creatable {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	if promotions, err := s.ListPatternToNewSchedules(); err != nil || len(promotions) != 0 {
		t.Fatalf("promotions=%+v err=%v", promotions, err)
	}
	rule := preview.Schedule
	created, err := s.CreatePatternSchedule(anchor.ID, preview.PatternKey, "grocer", "test-actor", types.Schedule{ID: "rule-1", Name: rule.Name, SourceAccountID: rule.SourceAccountID, Destinations: rule.Destinations, Amount: types.ExpressionAmountResolution(rule.Amount), Recurrence: rule.Recurrence, StartDate: rule.StartDate, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if string(created.StartDate) != "2026-01-15" {
		t.Fatalf("start=%s", created.StartDate)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	claimed := map[string]string{}
	for _, transaction := range model.Transactions {
		if transaction.Claim != nil && transaction.Claim.ScheduleID == created.ID {
			claimed[transaction.ID] = transaction.Claim.OccurrenceDate
		}
	}
	if len(claimed) != 3 || claimed[preview.Occurrences[0].TransactionID] != "2026-01-15" || claimed[preview.Occurrences[1].TransactionID] != "2026-02-15" || claimed[preview.Occurrences[2].TransactionID] != "2026-03-15" {
		t.Fatalf("claims=%+v", claimed)
	}
	promotions, err := s.ListPatternToNewSchedules()
	if err != nil || len(promotions) != 1 || promotions[0].MerchantKey != "grocer" || promotions[0].ScheduleID != created.ID {
		t.Fatalf("promotions=%+v err=%v", promotions, err)
	}
	blocked, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || blocked.Creatable || blocked.ExistingScheduleID != created.ID || blocked.Reason == "" {
		t.Fatalf("blocked=%+v err=%v", blocked, err)
	}
	created.Enabled = false
	if _, err := s.UpdateSchedule(created); err != nil {
		t.Fatal(err)
	}
	freed, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || !freed.Creatable || freed.ExistingScheduleID != "" {
		t.Fatalf("freed=%+v err=%v", freed, err)
	}
	if err := s.DeleteSchedule(created.ID); err != nil {
		t.Fatal(err)
	}
}

func TestPatternToNewScheduleClearRemovesLinks(t *testing.T) {
	s := openSQLiteStore(t)
	findings := seedPatternFindings(t, s, "recurring", "monthly", "GROCER 123", "-30.00", "grocer", "outflow")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	rule := preview.Schedule
	if _, err := s.CreatePatternSchedule(anchor.ID, preview.PatternKey, "grocer", "test-actor", types.Schedule{ID: "rule-1", Name: rule.Name, SourceAccountID: rule.SourceAccountID, Destinations: rule.Destinations, Amount: types.ExpressionAmountResolution(rule.Amount), Recurrence: rule.Recurrence, StartDate: rule.StartDate, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if promotions, err := s.ListPatternToNewSchedules(); err != nil || len(promotions) != 0 {
		t.Fatalf("promotions=%+v err=%v", promotions, err)
	}
}
