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
		ID: "rent", Name: "Rent", Frequency: types.FrequencyMonthly,
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
