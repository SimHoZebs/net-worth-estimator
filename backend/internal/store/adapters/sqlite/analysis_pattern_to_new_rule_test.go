package sqlite

import (
	"errors"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedRecurringEvidence(t *testing.T, s *sqliteStore) []string {
	t.Helper()
	seedAccount(t, s, "checking")
	ids := []string{}
	stamps := []time.Time{
		time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC),
	}
	amounts := []string{"-29.50", "-30.00", "-30.50"}
	for i, stamp := range stamps {
		transaction := bankSeedTransaction("Grocer weekly shop", "checking", "30", false)
		transaction.PostedTime = stamp.Unix()
		transaction.TransactionTime = stamp.Unix()
		keys := bankKeys(ProviderSimpleFIN, "bank", "grocery-"+string(rune('a'+i)))
		applyDirectives(t, s, []BankDirective{
			bankUpsertDirective(transaction, ProviderSimpleFIN, "bank", "grocery-"+string(rune('a'+i))),
			{Observe: &BankObservation{Keys: keys, Facts: types.TransactionFacts{Description: "GROCER 123", Amount: amounts[i], Currency: "USD", PostedTime: stamp.Unix(), OccurredAt: stamp.Unix()}}},
		})
		rows, err := s.LoadBankTransactions()
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, rows[len(rows)-1].Transaction.ID)
	}
	return ids
}

func completePatternAnalysis(t *testing.T, s *sqliteStore, ids []string, cadence string) []types.AnalysisFinding {
	t.Helper()
	run, _, claimed, err := s.ClaimAnalysis("recurring", "recurring-test-v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{
			TransactionID: id, Kind: "recurring", Provider: "grocer", Product: cadence, Role: "outflow", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", Reason: "test pattern", TransactionIDs: ids}},
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

func TestPatternToNewSchedulePreviewDerivesRuleAfterEvidence(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "monthly")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Creatable || preview.Reason != "" || preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	if preview.Cadence != "monthly" || preview.Direction != "outflow" || preview.AccountID != "checking" || preview.TypicalAmount != "30.00" || preview.Currency != "USD" {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Occurrences) != 3 || preview.Occurrences[0].Date != "2026-01-15" || preview.Occurrences[2].Date != "2026-03-15" {
		t.Fatalf("occurrences=%+v", preview.Occurrences)
	}
	rule := preview.Schedule
	if rule.Frequency != types.FrequencyMonthly || rule.StartDate != "2026-04-15" || rule.Amount != "30.00" || !rule.Enabled || rule.Name != "Grocer weekly shop" {
		t.Fatalf("rule=%+v", rule)
	}
	if rule.SourceAccountID == nil || *rule.SourceAccountID != "checking" || len(rule.Destinations) != 0 {
		t.Fatalf("routing=%+v", rule)
	}
	wantUpcoming := []string{"2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"}
	if len(preview.Upcoming) != len(wantUpcoming) {
		t.Fatalf("upcoming=%+v", preview.Upcoming)
	}
	for i, date := range wantUpcoming {
		if preview.Upcoming[i].Date != date || preview.Upcoming[i].Amount != "30.00" {
			t.Fatalf("upcoming=%+v", preview.Upcoming)
		}
	}
}

func TestPatternToNewSchedulePreviewGuards(t *testing.T) {
	s := openSQLiteStore(t)
	if _, err := s.PreviewPatternToNewSchedule("missing"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing=%v", err)
	}
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "monthly")
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{{TransactionID: ids[0], Kind: "bnpl", Provider: "grocer", Strength: "strong"}}, ""); err != nil {
		t.Fatal(err)
	}
	bnpl, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{ids[0]}})
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
	if _, err := s.db.Exec(`UPDATE transactions SET void=1 WHERE id=? AND user_id=:user_id`, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewPatternToNewSchedule(anchor.ID); !errors.Is(err, store.ErrPatternToNewScheduleConflict) {
		t.Fatalf("voided=%v", err)
	}
}

func TestPatternToNewSchedulePreviewLeavesBiweeklyVisible(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "biweekly")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Creatable || preview.Schedule != nil || len(preview.Upcoming) != 0 || preview.Reason == "" {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Occurrences) != 3 {
		t.Fatalf("occurrences=%+v", preview.Occurrences)
	}
}

func TestPatternToNewScheduleTracksOneActiveRule(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "monthly")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || !preview.Creatable {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	if _, err := s.FindPatternToNewSchedule(preview.PatternKey); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("record=%v", err)
	}
	rule, err := s.CreateSchedule(types.Schedule{Name: "Grocer", SourceAccountID: &[]string{"checking"}[0], Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "30.00"}, Inputs: map[string]types.AmountInputBinding{}}, Frequency: types.FrequencyMonthly, StartDate: "2026-04-15", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RecordPatternToNewSchedule(types.PatternToNewSchedule{PatternKey: preview.PatternKey, ScheduleID: rule.ID}); err != nil {
		t.Fatal(err)
	}
	blocked, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || blocked.Creatable || blocked.ExistingScheduleID != rule.ID || blocked.Reason == "" {
		t.Fatalf("blocked=%+v err=%v", blocked, err)
	}
	rule.Enabled = false
	if _, err := s.UpdateSchedule(rule); err != nil {
		t.Fatal(err)
	}
	freed, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil || !freed.Creatable || freed.ExistingScheduleID != "" {
		t.Fatalf("freed=%+v err=%v", freed, err)
	}
	if err := s.RemovePatternToNewSchedule(preview.PatternKey, "other-rule"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindPatternToNewSchedule(preview.PatternKey); err != nil {
		t.Fatalf("conditional remove cleared a live record: %v", err)
	}
	if err := s.RemovePatternToNewSchedule(preview.PatternKey, rule.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindPatternToNewSchedule(preview.PatternKey); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("record=%v", err)
	}
	if err := s.DeleteSchedule(rule.ID); err != nil {
		t.Fatal(err)
	}
}

func TestPatternToNewScheduleClearRemovesLinks(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "monthly")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RecordPatternToNewSchedule(types.PatternToNewSchedule{PatternKey: preview.PatternKey, ScheduleID: "rule-1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindPatternToNewSchedule(preview.PatternKey); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("record=%v", err)
	}
}

func TestPatternClaimConfirmRejectGeneralizes(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedRecurringEvidence(t, s)
	findings := completePatternAnalysis(t, s, ids, "monthly")
	confirmed := confirmFinding(t, s, findings[0])
	if confirmed.Review.Decision != "confirmed" {
		t.Fatalf("review=%+v", confirmed.Review)
	}
	duration := feedbackInput(t, confirmed, "set-duration")
	duration.Duration = &types.AnalysisDuration{Count: 4, Unit: "weeks"}
	if _, err := s.ReviewAnalysisFinding(confirmed.ID, duration); !errors.Is(err, store.ErrAnalysisFeedbackInvalid) {
		t.Fatalf("duration=%v", err)
	}
	next, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range next {
		if item.ID == findings[1].ID {
			rejected, err := s.ReviewAnalysisFinding(item.ID, feedbackInput(t, item, "reject"))
			if err != nil || rejected.Review.Decision != "rejected" {
				t.Fatalf("reject=%+v err=%v", rejected, err)
			}
		}
	}
}
