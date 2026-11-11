package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func autoClaimTestAmount(value string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": value},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

func autoClaimTestTransaction(id, name string, day string, amount string, source *string) types.Transaction {
	stamp := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC).Unix()
	if day != "" {
		stamp = MustParseIsoDate(day).Unix() + 12*3600
	}
	return types.Transaction{
		ID:              id,
		Name:            name,
		SourceAccountID: source,
		Destinations:    nil,
		Amount:          autoClaimTestAmount(amount),
		PostedTime:      stamp,
		TransactionTime: stamp,
		Enabled:         true,
	}
}

func TestMatchAutoClaimPicksClosestUnclaimed(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID:              "rent",
		Name:            "Rent",
		SourceAccountID: &account,
		Amount:          autoClaimTestAmount("1000"),
		Frequency:       types.FrequencyMonthly,
		StartDate:       "2026-01-01",
		Enabled:         true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-02", "1000", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{})
	if match == nil || match.ScheduleID != "rent" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want rent on 2026-02-01", match)
	}
}

func TestMatchAutoClaimSkipsClaimedDate(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID:              "rent",
		Name:            "Rent",
		SourceAccountID: &account,
		Amount:          autoClaimTestAmount("1000"),
		Frequency:       types.FrequencyMonthly,
		StartDate:       "2026-01-01",
		Enabled:         true,
	}}
	claimed := map[string]map[string]bool{"rent": {"2026-02-01": true}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-02", "1000", &account)
	if match := MatchAutoClaim(transaction, schedules, claimed); match != nil {
		t.Fatalf("match = %+v, want nil for claimed date", match)
	}
}

func TestMatchAutoClaimRejectsAmbiguous(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{
		{ID: "a", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", Enabled: true},
		{ID: "b", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", Enabled: true},
	}
	transaction := autoClaimTestTransaction("tx-1", "Gym", "2026-02-01", "50", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for ambiguous schedules", match)
	}
}

func TestMatchAutoClaimRejectsAmountOutsideTolerance(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1200", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for amount outside tolerance", match)
	}
}

func TestFindAutoClaimsClaimsSequentially(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	first := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	second := autoClaimTestTransaction("tx-2", "Rent", "2026-02-02", "1000", &account)
	updates := FindAutoClaims([]types.Transaction{first, second}, schedules)
	if len(updates) != 1 || updates[0].TransactionID != "tx-1" {
		t.Fatalf("updates = %+v, want only tx-1", updates)
	}
}

func TestMatchAutoClaimRejectsDisabled(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Enabled = false
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for disabled row", match)
	}
}

func TestMatchAutoClaimRejectsVoid(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Void = true
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for void row", match)
	}
}

func TestMatchAutoClaimAllowsPendingBankRow(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Enabled = false
	transaction.Pending = true
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{})
	if match == nil || match.ScheduleID != "rent" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want pending bank row claimed on 2026-02-01", match)
	}
}

func TestMatchAutoClaimRejectsDisabledSchedule(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: false,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for disabled schedule", match)
	}
}

func TestFindAutoClaimsSkipsDisabledAndVoid(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	disabled := autoClaimTestTransaction("tx-disabled", "Rent", "2026-02-01", "1000", &account)
	disabled.Enabled = false
	voided := autoClaimTestTransaction("tx-void", "Rent", "2026-02-01", "1000", &account)
	voided.Void = true
	updates := FindAutoClaims([]types.Transaction{disabled, voided}, schedules)
	if len(updates) != 0 {
		t.Fatalf("updates = %+v, want none for disabled/void rows", updates)
	}
}

func TestMatchAutoClaimFindsOldDailySchedule(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "daily", Name: "Coffee", SourceAccountID: &account,
		Amount: autoClaimTestAmount("5"), Frequency: types.FrequencyDaily,
		StartDate: "2016-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Coffee", "2026-02-01", "5", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{})
	if match == nil || match.ScheduleID != "daily" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want daily on 2026-02-01", match)
	}
}

func TestMatchAutoClaimPrefersCloserAmountOnSameDayDistance(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{
		{ID: "a", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Frequency: types.FrequencyMonthly, StartDate: "2026-01-15", Enabled: true},
		{ID: "b", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("55"), Frequency: types.FrequencyMonthly, StartDate: "2026-01-15", Enabled: true},
	}
	transaction := autoClaimTestTransaction("tx-1", "Gym", "2026-02-15", "50", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{})
	if match == nil || match.ScheduleID != "a" {
		t.Fatalf("match = %+v, want schedule a by closer amount", match)
	}
}

func TestMatchAutoClaimRejectsSubstringName(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rule", Name: "SplitRule", SourceAccountID: &account,
		Amount: autoClaimTestAmount("10"), Frequency: types.FrequencyMonthly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Split", "2026-07-02", "10", &account)
	transaction.Destinations = []string{"checking", "savings"}
	schedules[0].Destinations = []string{"checking", "savings"}
	schedules[0].SourceAccountID = nil
	transaction.SourceAccountID = nil
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}); match != nil {
		t.Fatalf("match = %+v, want nil for substring-only name", match)
	}
}

func TestMatchAutoClaimAcceptsTokenSubsetDescriptor(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "lyft", Name: "Lyft", SourceAccountID: &account,
		Amount: autoClaimTestAmount("25"), Frequency: types.FrequencyWeekly,
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "LYFT *STANDARD 10-30", "2026-01-08", "25", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{})
	if match == nil || match.ScheduleID != "lyft" || match.OccurrenceDate != "2026-01-08" {
		t.Fatalf("match = %+v, want lyft on 2026-01-08", match)
	}
}
