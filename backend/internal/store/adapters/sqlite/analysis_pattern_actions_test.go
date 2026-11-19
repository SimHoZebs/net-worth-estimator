package sqlite

import (
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternActionsRollBackAcceptance(t *testing.T) {
	for _, action := range []string{"create", "link"} {
		t.Run(action, func(t *testing.T) {
			s := openSQLiteStore(t)
			finding := seedPatternFindings(t, s, "recurring", "monthly", "GROCER 123", "-30.00", "grocer", "outflow")[0]
			preview, err := s.PreviewPatternToNewSchedule(finding.ID)
			if err != nil {
				t.Fatal(err)
			}
			account := "checking"
			rule := types.Schedule{ID: uuid.NewString(), Name: "Grocer", SourceAccountID: &account, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "30"}, Inputs: map[string]types.AmountInputBinding{}}, Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: "2026-01-15", Enabled: true}
			if action == "create" {
				if _, err := s.db.Exec(`CREATE TRIGGER fail_pattern_schedule BEFORE INSERT ON recurrence_rules BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
					t.Fatal(err)
				}
				_, err = s.CreatePatternSchedule(finding.ID, preview.PatternKey, preview.Merchant, "verified-subject", rule)
			} else {
				if _, err := s.CreateSchedule(rule); err != nil {
					t.Fatal(err)
				}
				if _, err := s.db.Exec(`CREATE TRIGGER fail_pattern_claim BEFORE INSERT ON transaction_claims BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
					t.Fatal(err)
				}
				_, err = s.SetPatternTransactionClaims(finding.ID, "verified-subject", []types.TransactionClaimUpdate{{TransactionID: finding.TransactionID, Claim: types.TransactionClaim{ScheduleID: rule.ID, OccurrenceDate: "2026-01-15"}}})
			}
			if err == nil {
				t.Fatal("expected persistence failure")
			}
			feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
			if err != nil || len(feedback) != 0 {
				t.Fatalf("failed action saved acceptance: %+v %v", feedback, err)
			}
			findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range findings {
				if item.Review != nil || item.FeedbackRevision != 0 {
					t.Fatalf("failed action changed review: %+v", item)
				}
			}
		})
	}
}
