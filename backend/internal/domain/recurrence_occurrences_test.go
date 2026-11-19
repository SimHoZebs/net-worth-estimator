package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The occurrence-list default horizon is three month-clamped calendar
// months, the same arithmetic monthly expansion uses.
func TestDefaultScheduleOccurrencesThroughClampsMonthEnd(t *testing.T) {
	if got := DefaultScheduleOccurrencesThrough("2026-01-31"); got != "2026-04-30" {
		t.Fatalf("through from Jan 31 = %q, want Apr 30 (clamped)", got)
	}
	if got := DefaultScheduleOccurrencesThrough("2026-10-31"); got != "2027-01-31" {
		t.Fatalf("through from Oct 31 = %q, want Jan 31 next year", got)
	}
	if got := DefaultScheduleOccurrencesThrough("2026-11-17"); got != "2027-02-17" {
		t.Fatalf("through from Nov 17 = %q, want Feb 17", got)
	}
}

func TestDefaultScheduleOccurrencesThroughShapesExpansion(t *testing.T) {
	// A monthly rule from the clamped edge expands through the clamped
	// horizon without reimplementing the end-date cap: passing the default
	// through into RuleScheduleDates keeps Jan 31 -> Feb 28 -> Mar 31.
	rule := types.Schedule{
		ID: "rent", Name: "Rent", Recurrence: monthlyTestRecurrence(),
		StartDate: "2026-01-31", Priority: 1, Enabled: true,
	}
	through := DefaultScheduleOccurrencesThrough("2026-01-31")
	if through != "2026-04-30" {
		t.Fatalf("through = %q, want 2026-04-30", through)
	}
	got := RuleScheduleDates(&rule, through)
	want := []string{"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"}
	if len(got) != len(want) {
		t.Fatalf("dates = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("dates = %v, want %v", got, want)
		}
	}
}

func scheduleDatesEqual(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("dates = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("dates = %v, want %v", got, want)
		}
	}
}

func TestEveryTwoMonthsByDate(t *testing.T) {
	rule := types.Schedule{
		ID: "dues", Name: "Dues",
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 2, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate:  "2026-01-15", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-06-01"), []string{"2026-01-15", "2026-03-15", "2026-05-15"})
	if !ruleOccursOn(&rule, "2026-03-15") || ruleOccursOn(&rule, "2026-02-15") {
		t.Fatal("every-2-months must hit March 15 and skip February 15")
	}
}

func TestEveryThreeWeeksOnSunday(t *testing.T) {
	// 2026-01-04 is a Sunday; week windows anchor on the start date.
	rule := types.Schedule{
		ID: "share", Name: "Share",
		Recurrence: types.Recurrence{Unit: types.RecurrenceWeek, Interval: 3, Weekdays: []int{0}},
		StartDate:  "2026-01-04", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-03-01"), []string{"2026-01-04", "2026-01-25", "2026-02-15"})
	if !ruleOccursOn(&rule, "2026-01-25") || ruleOccursOn(&rule, "2026-01-11") {
		t.Fatal("every-3-weeks must hit Jan 25 and skip the in-between Sunday Jan 11")
	}
}

func TestMonthlyThirdTuesdayByNthWeekday(t *testing.T) {
	// 2026-01-20 is the third Tuesday of January and not in its last week.
	rule := types.Schedule{
		ID: "club", Name: "Club",
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByNthWeekday},
		StartDate:  "2026-01-20", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-04-01"), []string{"2026-01-20", "2026-02-17", "2026-03-17"})
	if !ruleOccursOn(&rule, "2026-02-17") || ruleOccursOn(&rule, "2026-02-10") {
		t.Fatal("third-Tuesday must hit Feb 17 and skip Feb 10")
	}
}

func TestMonthStartByDate(t *testing.T) {
	rule := types.Schedule{
		ID: "rent", Name: "Rent",
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate},
		StartDate:  "2026-01-01", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-04-01"), []string{"2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"})
}

func TestLastFridayByNthWeekdaySkipsNothing(t *testing.T) {
	// 2026-01-30 is the fifth and last Friday of January. February 2026 has
	// no fifth Friday, but the last-Friday shape still fires on Feb 27: the
	// isLast derivation never skips, while a strict fifth-weekday lookup
	// reports the month missing.
	rule := types.Schedule{
		ID: "board", Name: "Board",
		Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByNthWeekday},
		StartDate:  "2026-01-30", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-04-30"), []string{"2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"})
	if !ruleOccursOn(&rule, "2026-02-27") {
		t.Fatal("last-Friday must hit Feb 27 despite the missing fifth Friday")
	}
	if _, ok := nthWeekdayDate(2026, 2, 5, 5, false); ok {
		t.Fatal("strict fifth Friday of February 2026 must be missing")
	}
}

func TestWeeklyTuesdayThursday(t *testing.T) {
	// 2026-01-06 is a Tuesday; week windows anchor on the start date.
	rule := types.Schedule{
		ID: "gym", Name: "Gym",
		Recurrence: types.Recurrence{Unit: types.RecurrenceWeek, Interval: 1, Weekdays: []int{2, 4}},
		StartDate:  "2026-01-06", Priority: 1, Enabled: true,
	}
	scheduleDatesEqual(t, RuleScheduleDates(&rule, "2026-01-20"), []string{"2026-01-06", "2026-01-08", "2026-01-13", "2026-01-15", "2026-01-20"})
	if !ruleOccursOn(&rule, "2026-01-08") || ruleOccursOn(&rule, "2026-01-07") {
		t.Fatal("Tue+Thu must hit Jan 8 and skip Wed Jan 7")
	}
}
