package sqlite

import (
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPatternToNewSchedulePreviewAcceptsIncomeKind(t *testing.T) {
	s := openSQLiteStore(t)
	findings := seedPatternFindings(t, s, "income", "monthly", "ACME PAYROLL", "3000.00", "ACME PAYROLL", "inflow")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Creatable || preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	rule := preview.Schedule
	created, err := s.CreatePatternSchedule(anchor.ID, preview.PatternKey, preview.Merchant, "verified-subject", types.Schedule{
		ID: uuid.NewString(), Name: rule.Name, SourceAccountID: rule.SourceAccountID, Destinations: rule.Destinations,
		Amount:    types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": rule.Amount}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency: rule.Frequency, StartDate: rule.StartDate, Enabled: true,
	})
	if err != nil || created.ID == "" {
		t.Fatalf("create=%+v err=%v", created, err)
	}
	if string(created.StartDate) != "2026-01-15" {
		t.Fatalf("start=%s", created.StartDate)
	}
	promotions, err := s.ListPatternToNewSchedules()
	if err != nil || len(promotions) != 1 || promotions[0].MerchantKey != preview.Merchant || promotions[0].ScheduleID != created.ID {
		t.Fatalf("promotions=%+v err=%v", promotions, err)
	}
	model, err := s.LoadModel()
	if err != nil || len(model.Schedules) != 1 {
		t.Fatalf("model=%+v err=%v", model, err)
	}
	claimed := map[string]string{}
	for _, transaction := range model.Transactions {
		if transaction.Claim != nil && transaction.Claim.ScheduleID == created.ID {
			claimed[transaction.ID] = transaction.Claim.OccurrenceDate
		}
	}
	if len(claimed) != 3 {
		t.Fatalf("claims=%+v", claimed)
	}
	for _, occurrence := range preview.Occurrences {
		if claimed[occurrence.TransactionID] != occurrence.Date {
			t.Fatalf("claims=%+v occurrences=%+v", claimed, preview.Occurrences)
		}
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Review == nil || feedback[0].Review.Decision != "confirmed" {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
}

func TestPatternToExistingScheduleAcceptsRentKind(t *testing.T) {
	s := openSQLiteStore(t)
	findings := seedPatternFindings(t, s, "rent", "monthly", "RENT PAYMENT", "-1200.00", "Rent", "outflow")
	anchor := confirmFinding(t, s, findings[0])
	account := "checking"
	rule, err := s.CreateSchedule(types.Schedule{Name: "Rent", SourceAccountID: &account, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1200.00"}, Inputs: map[string]types.AmountInputBinding{}}, Frequency: types.FrequencyMonthly, StartDate: "2026-01-15", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewPatternToExistingSchedule(anchor.ID, rule.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Claimable || len(preview.Assignments) != 3 {
		t.Fatalf("preview=%+v", preview)
	}
	claims := make([]types.TransactionClaimUpdate, 0, len(preview.Assignments))
	for _, item := range preview.Assignments {
		claims = append(claims, types.TransactionClaimUpdate{TransactionID: item.TransactionID, Claim: types.TransactionClaim{ScheduleID: rule.ID, OccurrenceDate: item.Date}})
	}
	rows, err := s.SetPatternTransactionClaims(anchor.ID, "verified-subject", claims)
	if err != nil || len(rows) != 3 {
		t.Fatalf("claims=%+v err=%v", rows, err)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	claimed := 0
	for _, transaction := range model.Transactions {
		if transaction.Claim != nil && transaction.Claim.ScheduleID == rule.ID {
			claimed++
		}
	}
	if claimed != 3 {
		t.Fatalf("claimed=%d model=%+v", claimed, model.Transactions)
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Review == nil || feedback[0].Review.Decision != "confirmed" {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
}
