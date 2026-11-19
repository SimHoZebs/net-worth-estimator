package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Test recurrence constructors mirror the Google-lite contract: unit plus
// interval, with weekdays for weekly shapes and a mode for monthly ones.
func dailyTestRecurrence() types.Recurrence {
	return types.Recurrence{Unit: types.RecurrenceDay, Interval: 1}
}

func weeklyTestRecurrence(weekdays ...int) types.Recurrence {
	return types.Recurrence{Unit: types.RecurrenceWeek, Interval: 1, Weekdays: weekdays}
}

func monthlyTestRecurrence() types.Recurrence {
	return types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}
}

// Claim linkage: a manual transaction records the actual for one scheduled rule
// occurrence. History replays the actual and skips the generated occurrence,
// so the balance takes one hit instead of two. Future occurrences are
// unaffected.

func claimTestModel() *types.FinancialModel {
	checking := "checking"
	return &types.FinancialModel{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay(checking, "Checking")},
		},
		Checkpoints: []types.Checkpoint{
			{AccountID: checking, Balance: 10000, ObservedAt: 1764633599},
		},
		Transactions: []types.Transaction{
			{
				ID: "rent-feb-actual", Name: "February rent (actual)",
				SourceAccountID: &checking,
				Amount: types.TransactionAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "950"},
				},
				PostedTime: 1770249600, TransactionTime: 1770249600,
				Claim: &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"},

				Enabled: true,
			},
		},
		Schedules: []types.Schedule{
			{
				ID: "rent", Name: "Rent",
				SourceAccountID: &checking,
				Amount: types.TransactionAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "1000"},
				},
				Recurrence: monthlyTestRecurrence(),
				StartDate:  "2026-01-01",
				Priority:   1,
				Enabled:    true,
			},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func claimTestSettings() *types.ProjectionRuntimeSettings {
	return &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-03-01",
		HorizonYears:                1,
		Evaluations:                 types.EmptyEvaluationTables(),
	}
}

func historicalBalance(t *testing.T, path *types.ProjectionPath, date, accountID string) float64 {
	t.Helper()
	for _, row := range path.Rows {
		if row.Date != date || !row.IsHistorical {
			continue
		}
		for _, snapshot := range row.AccountSnapshots {
			if snapshot.AccountID == accountID {
				return snapshot.Balance
			}
		}
	}
	t.Fatalf("no historical row for %s", date)
	return 0
}

func TestClaimSuppressesGeneratedOccurrence(t *testing.T) {
	path, _, err := ProjectRawFinancialModel(claimTestModel(), claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// January scheduled rent (1000) plus the February actual (950).
	// The February scheduled occurrence is skipped.
	if got := historicalBalance(t, path, "2026-02-05", "checking"); got != 8050 {
		t.Fatalf("checking after actual = %v, want 8050 (one hit, not two)", got)
	}
	buckets := path.ProjectionStartTransactionState.RealizedTransactionAmountsByYear
	// Timestamp-only replay includes the start-day rule through the cut, so
	// January plus March anchor in history; February stays claimed.
	if buckets["rent"]["2026"] != 2000 {
		t.Fatalf("rent bucket = %v, want 2000 (January plus March)", buckets["rent"]["2026"])
	}
	if buckets["rent-feb-actual"]["2026"] != 950 {
		t.Fatalf("actual bucket = %v, want 950", buckets["rent-feb-actual"]["2026"])
	}
}

func TestUnclaimedOccurrenceReplaysNormally(t *testing.T) {
	model := claimTestModel()
	model.Transactions[0].Claim = nil
	path, _, err := ProjectRawFinancialModel(model, claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// Both the scheduled February rent and the unlinked actual replay.
	if got := historicalBalance(t, path, "2026-02-05", "checking"); got != 7050 {
		t.Fatalf("checking without claim = %v, want 7050 (double count)", got)
	}
}

func TestClaimLeavesFutureOccurrencesAlone(t *testing.T) {
	path, _, err := ProjectRawFinancialModel(claimTestModel(), claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// Timestamp-only history includes the start-day rule through the cut, so
	// March anchors in history rather than simulating as future.
	if got := historicalBalance(t, path, "2026-03-01", "checking"); got != 7050 {
		t.Fatalf("March history = %v, want 7050 (Jan plus Feb actual plus March)", got)
	}
	for _, event := range path.TransactionEvents {
		if event.Origin.TransactionID == "rent" && event.Date == "2026-03-01" {
			t.Fatalf("March rent must not simulate twice (already in history)")
		}
	}
}

func TestClaimValidation(t *testing.T) {
	cases := []struct {
		name  string
		claim *types.TransactionClaim
		code  string
	}{
		{"missing rule", &types.TransactionClaim{ScheduleID: "ghost", OccurrenceDate: "2026-02-01"}, "transaction.claim.schedule.missing"},
		{"unscheduled date", &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-15"}, "transaction.claim.date.unscheduled"},
		{"before rule start", &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2025-12-01"}, "transaction.claim.date.range"},
		{"bad date format", &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "Feb 1"}, "transaction.claim.date.format"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			model := claimTestModel()
			model.Transactions[0].Claim = testCase.claim
			found := false
			for _, issue := range ValidateFinancialModel(model) {
				if issue.Code == testCase.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected %q, got %+v", testCase.code, ValidateFinancialModel(model))
			}
		})
	}
}

func TestDuplicateClaimRejected(t *testing.T) {
	model := claimTestModel()
	duplicate := model.Transactions[0]
	duplicate.ID = "rent-feb-actual-2"
	model.Transactions = append(model.Transactions, duplicate)
	found := false
	for _, issue := range ValidateFinancialModel(model) {
		if issue.Code == "transaction.claim.duplicate" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected transaction.claim.duplicate, got %+v", ValidateFinancialModel(model))
	}
}

func TestClaimValidationOnNewExpansion(t *testing.T) {
	newRuleModel := func() *types.FinancialModel {
		checking := "checking"
		return &types.FinancialModel{
			SourcePath: "test",
			Accounts: []types.Account{
				{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay(checking, "Checking")},
			},
			Transactions: []types.Transaction{
				{
					ID: "gym-actual", Name: "Gym",
					SourceAccountID: &checking,
					Amount: types.TransactionAmountResolution{
						Resolver: "expression",
						Config:   map[string]any{"expression": "50"},
					},
					PostedTime: 1767825600, TransactionTime: 1767825600,
					Claim:   &types.TransactionClaim{ScheduleID: "gym", OccurrenceDate: "2026-01-08"},
					Enabled: true,
				},
			},
			Schedules: []types.Schedule{
				{
					// 2026-01-06 is a Tuesday; the rule fires Tue and Thu.
					ID: "gym", Name: "Gym",
					SourceAccountID: &checking,
					Amount: types.TransactionAmountResolution{
						Resolver: "expression",
						Config:   map[string]any{"expression": "50"},
					},
					Recurrence: weeklyTestRecurrence(2, 4),
					StartDate:  "2026-01-06",
					Priority:   1,
					Enabled:    true,
				},
			},
			Evaluations: types.EmptyEvaluationTables(),
		}
	}
	issueCodes := func(model *types.FinancialModel) map[string]bool {
		codes := map[string]bool{}
		for _, issue := range ValidateFinancialModel(model) {
			codes[issue.Code] = true
		}
		return codes
	}
	// Thursday Jan 8 is scheduled: no claim issue.
	if codes := issueCodes(newRuleModel()); codes["transaction.claim.date.unscheduled"] {
		t.Fatalf("Thursday claim must validate, got %+v", ValidateFinancialModel(newRuleModel()))
	}
	// Wednesday Jan 7 is not a Tue/Thu occurrence.
	offModel := newRuleModel()
	offModel.Transactions[0].Claim.OccurrenceDate = "2026-01-07"
	if codes := issueCodes(offModel); !codes["transaction.claim.date.unscheduled"] {
		t.Fatalf("Wednesday claim must be unscheduled, got %+v", ValidateFinancialModel(offModel))
	}
	// A byNthWeekday third-Tuesday rule accepts its derived dates only.
	nthModel := newRuleModel()
	nthModel.Schedules[0].Recurrence = types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByNthWeekday}
	nthModel.Schedules[0].StartDate = "2026-01-20"
	nthModel.Transactions[0].Claim.OccurrenceDate = "2026-02-17"
	if codes := issueCodes(nthModel); codes["transaction.claim.date.unscheduled"] {
		t.Fatalf("third-Tuesday claim must validate, got %+v", ValidateFinancialModel(nthModel))
	}
	nthModel.Transactions[0].Claim.OccurrenceDate = "2026-02-10"
	if codes := issueCodes(nthModel); !codes["transaction.claim.date.unscheduled"] {
		t.Fatalf("second-Tuesday claim must be unscheduled, got %+v", ValidateFinancialModel(nthModel))
	}
}

func TestRecurrenceValidationCodes(t *testing.T) {
	checking := "checking"
	validSchedule := func() types.Schedule {
		return types.Schedule{
			ID: "rule", Name: "Rule",
			SourceAccountID: &checking,
			Amount: types.TransactionAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "10"},
			},
			Recurrence: monthlyTestRecurrence(),
			StartDate:  "2026-01-06",
			Enabled:    true,
		}
	}
	modelWith := func(mut func(*types.Schedule)) *types.FinancialModel {
		schedule := validSchedule()
		mut(&schedule)
		return &types.FinancialModel{
			SourcePath: "test",
			Accounts: []types.Account{
				{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay(checking, "Checking")},
			},
			Schedules:   []types.Schedule{schedule},
			Evaluations: types.EmptyEvaluationTables(),
		}
	}
	codesOf := func(model *types.FinancialModel) map[string]bool {
		codes := map[string]bool{}
		for _, issue := range ValidateFinancialModel(model) {
			if issue.Severity == types.SeverityError {
				codes[issue.Code] = true
			}
		}
		return codes
	}
	cases := []struct {
		name string
		mut  func(*types.Schedule)
		code string
	}{
		{"unknown unit", func(s *types.Schedule) {
			s.Recurrence = types.Recurrence{Unit: "fortnight", Interval: 1}
		}, "schedule.recurrence.unit.invalid"},
		{"zero interval", func(s *types.Schedule) {
			s.Recurrence.Interval = 0
		}, "schedule.recurrence.interval.invalid"},
		{"interval over 99", func(s *types.Schedule) {
			s.Recurrence.Interval = 100
		}, "schedule.recurrence.interval.invalid"},
		{"weekly without weekdays", func(s *types.Schedule) {
			s.Recurrence = weeklyTestRecurrence()
		}, "schedule.recurrence.weekdays.invalid"},
		{"weekly missing start weekday", func(s *types.Schedule) {
			// Start date 2026-01-06 is a Tuesday; Thursdays only excludes it.
			s.Recurrence = weeklyTestRecurrence(4)
		}, "schedule.recurrence.weekdays.invalid"},
		{"weekly duplicate weekdays", func(s *types.Schedule) {
			s.Recurrence = weeklyTestRecurrence(2, 2)
		}, "schedule.recurrence.weekdays.invalid"},
		{"weekly out-of-range weekday", func(s *types.Schedule) {
			s.Recurrence = weeklyTestRecurrence(2, 7)
		}, "schedule.recurrence.weekdays.invalid"},
		{"weekdays on daily", func(s *types.Schedule) {
			s.Recurrence = dailyTestRecurrence()
			s.Recurrence.Weekdays = []int{2}
		}, "schedule.recurrence.weekdays.invalid"},
		{"monthly without mode", func(s *types.Schedule) {
			s.Recurrence = types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1}
		}, "schedule.recurrence.monthly-mode.invalid"},
		{"monthly unknown mode", func(s *types.Schedule) {
			s.Recurrence = types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: "byWeek"}
		}, "schedule.recurrence.monthly-mode.invalid"},
		{"monthly mode on annual", func(s *types.Schedule) {
			s.Recurrence = types.Recurrence{Unit: types.RecurrenceYear, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}
		}, "schedule.recurrence.monthly-mode.invalid"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if codes := codesOf(modelWith(testCase.mut)); !codes[testCase.code] {
				t.Fatalf("expected %q, got %v", testCase.code, ValidateFinancialModel(modelWith(testCase.mut)))
			}
		})
	}
	// A valid weekly shape covering the start weekday reports no recurrence issue.
	valid := modelWith(func(s *types.Schedule) { s.Recurrence = weeklyTestRecurrence(2, 4) })
	for code := range codesOf(valid) {
		if code == "schedule.recurrence.unit.invalid" || code == "schedule.recurrence.interval.invalid" ||
			code == "schedule.recurrence.weekdays.invalid" || code == "schedule.recurrence.monthly-mode.invalid" {
			t.Fatalf("valid weekly schedule reports %q: %+v", code, ValidateFinancialModel(valid))
		}
	}
}

func TestRecurrenceDivisorValues(t *testing.T) {
	cases := []struct {
		name       string
		recurrence types.Recurrence
		want       float64
	}{
		{"daily", dailyTestRecurrence(), 365},
		{"every 2 days", types.Recurrence{Unit: types.RecurrenceDay, Interval: 2}, 182.5},
		{"weekly one day", weeklyTestRecurrence(0), 52},
		{"weekly two days", weeklyTestRecurrence(2, 4), 104},
		{"every 2 weeks one day", types.Recurrence{Unit: types.RecurrenceWeek, Interval: 2, Weekdays: []int{0}}, 26},
		{"monthly", monthlyTestRecurrence(), 12},
		{"quarterly as every 3 months", types.Recurrence{Unit: types.RecurrenceMonth, Interval: 3, MonthlyMode: types.RecurrenceMonthlyByDate}, 4},
		{"annual", types.Recurrence{Unit: types.RecurrenceYear, Interval: 1}, 1},
		{"unknown", types.Recurrence{}, 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := RecurrenceDivisor(testCase.recurrence); got != testCase.want {
				t.Fatalf("divisor = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestInvalidRuleRecurrenceExpandsToNothing(t *testing.T) {
	rule := types.Schedule{
		ID: "bad", Name: "Bad", Recurrence: types.Recurrence{Unit: types.RecurrenceUnit("fortnightly"), Interval: 1},
		StartDate: "2026-01-01", Priority: 1, Enabled: true,
	}
	if got := RuleScheduleDates(&rule, "2027-01-01"); len(got) != 0 {
		t.Fatalf("schedule dates for invalid recurrence = %v, want none", got)
	}
	resolved := ResolveOccurrences([]types.Schedule{rule}, nil, "2026-01-01", "2027-01-01", true)
	if len(resolved.ByDate) != 0 {
		t.Fatalf("occurrences for invalid recurrence = %v, want none", resolved.ByDate)
	}
}
