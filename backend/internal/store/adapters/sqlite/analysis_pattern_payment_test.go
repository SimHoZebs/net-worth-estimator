package sqlite

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedPaymentEvidence(t *testing.T, s *sqliteStore, name, description, amount string) []string {
	t.Helper()
	seedAccount(t, s, "checking")
	ids := []string{}
	stamps := []time.Time{
		time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC),
	}
	for i, stamp := range stamps {
		transaction := bankSeedTransaction(name, "checking", amount, false)
		transaction.PostedTime = stamp.Unix()
		transaction.TransactionTime = stamp.Unix()
		key := "payment-" + string(rune('a'+i))
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
	return ids
}

func completePaymentAnalysis(t *testing.T, s *sqliteStore, ids []string, kind, cadence, provider, role string) []types.AnalysisFinding {
	t.Helper()
	run, _, claimed, err := s.ClaimAnalysis("payments", "payments-test-v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{
			TransactionID: id, Kind: kind, Provider: provider, Product: cadence, Role: role, Strength: "moderate",
			Evidence:      []types.AnalysisEvidence{{Code: kind + ".cadence", Reason: "test pattern", TransactionIDs: ids}},
			Pattern:       &types.AnalysisPaymentPattern{PatternID: "pattern-" + kind, Currency: "USD", TypicalAmount: "3000.00"},
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

func TestPatternToNewSchedulePreviewAcceptsIncomeKind(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedPaymentEvidence(t, s, "ACME PAYROLL", "ACME PAYROLL", "3000.00")
	findings := completePaymentAnalysis(t, s, ids, "income", "monthly", "ACME PAYROLL", "inflow")
	anchor := confirmFinding(t, s, findings[0])
	preview, err := s.PreviewPatternToNewSchedule(anchor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Creatable || preview.Schedule == nil {
		t.Fatalf("preview=%+v", preview)
	}
	if preview.Cadence != "monthly" || preview.Direction != "inflow" || preview.AccountID != "checking" || preview.TypicalAmount != "3000.00" || preview.Currency != "USD" {
		t.Fatalf("preview=%+v", preview)
	}
	if len(preview.Occurrences) != 3 || preview.Occurrences[0].Date != "2026-01-15" || preview.Occurrences[2].Date != "2026-03-15" {
		t.Fatalf("occurrences=%+v", preview.Occurrences)
	}
	rule := preview.Schedule
	if rule.Frequency != types.FrequencyMonthly || rule.StartDate != "2026-04-15" || rule.Amount != "3000.00" || !rule.Enabled {
		t.Fatalf("rule=%+v", rule)
	}
	created, err := s.CreatePatternSchedule(anchor.ID, preview.PatternKey, "verified-subject", types.Schedule{
		ID: uuid.NewString(), Name: rule.Name, SourceAccountID: rule.SourceAccountID, Destinations: rule.Destinations,
		Amount:    types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": rule.Amount}, Inputs: map[string]types.AmountInputBinding{}},
		Frequency: rule.Frequency, StartDate: rule.StartDate, Enabled: true,
	})
	if err != nil || created.ID == "" {
		t.Fatalf("create=%+v err=%v", created, err)
	}
	model, err := s.LoadModel()
	if err != nil || len(model.Schedules) != 1 {
		t.Fatalf("model=%+v err=%v", model, err)
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].Review == nil || feedback[0].Review.Decision != "confirmed" {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
}

func TestPatternToExistingScheduleAcceptsRentKind(t *testing.T) {
	s := openSQLiteStore(t)
	ids := seedPaymentEvidence(t, s, "Rent", "RENT PAYMENT", "-1200.00")
	findings := completePaymentAnalysis(t, s, ids, "rent", "monthly", "Rent", "outflow")
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
