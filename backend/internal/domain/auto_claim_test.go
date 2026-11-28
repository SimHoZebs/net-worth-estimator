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

func TestAutoClaimLiteralCentsUsesNumericAmountParser(t *testing.T) {
	for _, tc := range []struct {
		name     string
		raw      string
		resolver string
		inputs   map[string]types.AmountInputBinding
		want     int64
		ok       bool
	}{
		{name: "padded decimal", raw: " 001.2300 ", resolver: "expression", want: 123, ok: true},
		{name: "exponent", raw: "1e3", resolver: "expression", want: 100000, ok: true},
		{name: "leading dot", raw: "+.5", resolver: "expression", want: 50, ok: true},
		{name: "zero", raw: "0", resolver: "expression"},
		{name: "negative", raw: "-1", resolver: "expression"},
		{name: "nonfinite", raw: "NaN", resolver: "expression"},
		{name: "calculated", raw: "1 + 2", resolver: "expression"},
		{name: "wrong resolver", raw: "1", resolver: "literal"},
		{name: "bound inputs", raw: "1", resolver: "expression", inputs: map[string]types.AmountInputBinding{"rate": {Source: "literal", Value: 1.0}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			amount := types.TransactionAmountResolution{Resolver: tc.resolver, Config: map[string]any{"expression": tc.raw}, Inputs: tc.inputs}
			got, ok := autoClaimLiteralCents(amount)
			if ok != tc.ok || (ok && got != tc.want) {
				t.Fatalf("cents = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.ok)
			}
		})
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
		Recurrence:      monthlyTestRecurrence(),
		StartDate:       "2026-01-01",
		Enabled:         true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-02", "1000", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
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
		Recurrence:      monthlyTestRecurrence(),
		StartDate:       "2026-01-01",
		Enabled:         true,
	}}
	claimed := map[string]map[string]bool{"rent": {"2026-02-01": true}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-02", "1000", &account)
	if match := MatchAutoClaim(transaction, schedules, claimed, nil); match != nil {
		t.Fatalf("match = %+v, want nil for claimed date", match)
	}
}

func TestMatchAutoClaimRejectsAmbiguous(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{
		{ID: "a", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-01-01", Enabled: true},
		{ID: "b", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-01-01", Enabled: true},
	}
	transaction := autoClaimTestTransaction("tx-1", "Gym", "2026-02-01", "50", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for ambiguous schedules", match)
	}
}

func TestMatchAutoClaimRejectsAmountOutsideTolerance(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1200", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for amount outside tolerance", match)
	}
}

func TestFindAutoClaimsClaimsSequentially(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	first := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	second := autoClaimTestTransaction("tx-2", "Rent", "2026-02-02", "1000", &account)
	updates := FindAutoClaims([]types.Transaction{first, second}, schedules, nil)
	if len(updates) != 1 || updates[0].TransactionID != "tx-1" {
		t.Fatalf("updates = %+v, want only tx-1", updates)
	}
}

func TestMatchAutoClaimRejectsDisabled(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Enabled = false
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for disabled row", match)
	}
}

func TestMatchAutoClaimRejectsVoid(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Void = true
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for void row", match)
	}
}

func TestMatchAutoClaimAllowsPendingBankRow(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	transaction.Enabled = false
	transaction.Pending = true
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "rent" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want pending bank row claimed on 2026-02-01", match)
	}
}

func TestMatchAutoClaimRejectsDisabledSchedule(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: false,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Rent", "2026-02-01", "1000", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for disabled schedule", match)
	}
}

func TestFindAutoClaimsSkipsDisabledAndVoid(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rent", Name: "Rent", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	disabled := autoClaimTestTransaction("tx-disabled", "Rent", "2026-02-01", "1000", &account)
	disabled.Enabled = false
	voided := autoClaimTestTransaction("tx-void", "Rent", "2026-02-01", "1000", &account)
	voided.Void = true
	updates := FindAutoClaims([]types.Transaction{disabled, voided}, schedules, nil)
	if len(updates) != 0 {
		t.Fatalf("updates = %+v, want none for disabled/void rows", updates)
	}
}

func TestMatchAutoClaimFindsOldDailySchedule(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "daily", Name: "Coffee", SourceAccountID: &account,
		Amount: autoClaimTestAmount("5"), Recurrence: dailyTestRecurrence(),
		StartDate: "2016-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Coffee", "2026-02-01", "5", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "daily" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want daily on 2026-02-01", match)
	}
}

func TestMatchAutoClaimFindsIntervalDailySchedule(t *testing.T) {
	account := "checking"
	// Every-2-days from 2020: 2026-02-04 is 2226 days after start, an
	// occurrence, exercising the interval-aware fast-forward offset.
	schedules := []types.Schedule{{
		ID: "every2", Name: "Coffee", SourceAccountID: &account,
		Amount: autoClaimTestAmount("5"), Recurrence: types.Recurrence{Unit: types.RecurrenceDay, Interval: 2},
		StartDate: "2020-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Coffee", "2026-02-04", "5", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "every2" || match.OccurrenceDate != "2026-02-04" {
		t.Fatalf("match = %+v, want every2 on 2026-02-04", match)
	}
}

func TestMatchAutoClaimFindsMultiWeekdayWeekly(t *testing.T) {
	account := "checking"
	// 2026-01-06 is a Tuesday; the rule fires Tue and Thu weekly.
	schedules := []types.Schedule{{
		ID: "gym", Name: "Gym", SourceAccountID: &account,
		Amount: autoClaimTestAmount("50"), Recurrence: weeklyTestRecurrence(2, 4),
		StartDate: "2026-01-06", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Gym", "2026-01-09", "50", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "gym" || match.OccurrenceDate != "2026-01-08" {
		t.Fatalf("match = %+v, want gym on 2026-01-08", match)
	}
}

func TestMatchAutoClaimPrefersCloserAmountOnSameDayDistance(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{
		{ID: "a", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("50"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-01-15", Enabled: true},
		{ID: "b", Name: "Gym", SourceAccountID: &account, Amount: autoClaimTestAmount("55"), Recurrence: monthlyTestRecurrence(), StartDate: "2026-01-15", Enabled: true},
	}
	transaction := autoClaimTestTransaction("tx-1", "Gym", "2026-02-15", "50", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "a" {
		t.Fatalf("match = %+v, want schedule a by closer amount", match)
	}
}

func TestMatchAutoClaimRejectsSubstringName(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "rule", Name: "SplitRule", SourceAccountID: &account,
		Amount: autoClaimTestAmount("10"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "Split", "2026-07-02", "10", &account)
	transaction.Destinations = []string{"checking", "savings"}
	schedules[0].Destinations = []string{"checking", "savings"}
	schedules[0].SourceAccountID = nil
	transaction.SourceAccountID = nil
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil); match != nil {
		t.Fatalf("match = %+v, want nil for substring-only name", match)
	}
}

func TestMatchAutoClaimAcceptsTokenSubsetDescriptor(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "lyft", Name: "Lyft", SourceAccountID: &account,
		Amount: autoClaimTestAmount("25"), Recurrence: weeklyTestRecurrence(4),
		StartDate: "2026-01-01", Enabled: true,
	}}
	transaction := autoClaimTestTransaction("tx-1", "LYFT *STANDARD 10-30", "2026-01-08", "25", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "lyft" || match.OccurrenceDate != "2026-01-08" {
		t.Fatalf("match = %+v, want lyft on 2026-01-08", match)
	}
}

func TestNormalizedMerchantKey(t *testing.T) {
	cases := []struct {
		text, want string
	}{
		{"NETFLIX.COM BILLING", "netflix"},
		{"  uber *trip 123 ", "uber"},
		{"12345 67890", ""},
		{"ab 12XYZ", "12xyz"},
		{"CAFE 123", "cafe"},
		{"A1 B2", ""},
		{"", ""},
	}
	for _, item := range cases {
		if got := NormalizedMerchantKey(item.text); got != item.want {
			t.Errorf("NormalizedMerchantKey(%q) = %q, want %q", item.text, got, item.want)
		}
	}
}

func TestMatchAutoClaimPromotionKeySurvivesRename(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "sub", Name: "Monthly Subscription", SourceAccountID: &account,
		Amount: autoClaimTestAmount("15"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	merchantKeys := map[string]string{"sub": "netflix"}
	transaction := autoClaimTestTransaction("tx-1", "NETFLIX.COM", "2026-02-02", "15", &account)
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, merchantKeys)
	if match == nil || match.ScheduleID != "sub" || match.OccurrenceDate != "2026-02-01" {
		t.Fatalf("match = %+v, want sub on 2026-02-01 from merchant key", match)
	}
}

func TestMatchAutoClaimPromotionKeyMismatchRefusesNameMatch(t *testing.T) {
	account := "checking"
	schedules := []types.Schedule{{
		ID: "sub", Name: "Netflix", SourceAccountID: &account,
		Amount: autoClaimTestAmount("15"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}}
	merchantKeys := map[string]string{"sub": "uber"}
	transaction := autoClaimTestTransaction("tx-1", "NETFLIX", "2026-02-01", "15", &account)
	if match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, merchantKeys); match != nil {
		t.Fatalf("match = %+v, want nil for mismatched promotion key", match)
	}
}

func TestMatchAutoClaimPromotionKeyRespectsOtherGates(t *testing.T) {
	account := "checking"
	other := "savings"
	baseSchedule := types.Schedule{
		ID: "sub", Name: "Renamed", SourceAccountID: &account,
		Amount: autoClaimTestAmount("1000"), Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-01", Enabled: true,
	}
	merchantKeys := map[string]string{"sub": "rent"}
	baseTransaction := func() types.Transaction {
		return autoClaimTestTransaction("tx-1", "RENT PAYMENT", "2026-02-02", "1000", &account)
	}

	cases := []struct {
		name      string
		schedule  types.Schedule
		transact  types.Transaction
		claimed   map[string]map[string]bool
		wantMatch bool
	}{
		{
			name:      "all gates pass",
			schedule:  baseSchedule,
			transact:  baseTransaction(),
			claimed:   map[string]map[string]bool{},
			wantMatch: true,
		},
		{
			name:      "route mismatch",
			schedule:  baseSchedule,
			transact:  autoClaimTestTransaction("tx-1", "RENT PAYMENT", "2026-02-02", "1000", &other),
			claimed:   map[string]map[string]bool{},
			wantMatch: false,
		},
		{
			name:      "amount outside tolerance",
			schedule:  baseSchedule,
			transact:  autoClaimTestTransaction("tx-1", "RENT PAYMENT", "2026-02-02", "1200", &account),
			claimed:   map[string]map[string]bool{},
			wantMatch: false,
		},
		{
			name:      "outside date window",
			schedule:  baseSchedule,
			transact:  autoClaimTestTransaction("tx-1", "RENT PAYMENT", "2026-01-20", "1000", &account),
			claimed:   map[string]map[string]bool{},
			wantMatch: false,
		},
		{
			name:      "claimed date",
			schedule:  baseSchedule,
			transact:  baseTransaction(),
			claimed:   map[string]map[string]bool{"sub": {"2026-02-01": true}},
			wantMatch: false,
		},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			match := MatchAutoClaim(item.transact, []types.Schedule{item.schedule}, item.claimed, merchantKeys)
			if item.wantMatch {
				if match == nil || match.ScheduleID != "sub" || match.OccurrenceDate != "2026-02-01" {
					t.Fatalf("match = %+v, want sub on 2026-02-01", match)
				}
				return
			}
			if match != nil {
				t.Fatalf("match = %+v, want nil", match)
			}
		})
	}
}
