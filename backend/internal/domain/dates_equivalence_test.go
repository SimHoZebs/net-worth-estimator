package domain

import (
	"math"
	"testing"
)

// Pins integer-date helpers against time-based semantics on edge cases:
// leap days, month-end clamping, year boundaries, and long spans.
func TestFastDateEquivalence(t *testing.T) {
	datePairs := [][2]string{
		{"2026-09-21", "2026-09-21"},
		{"2026-09-21", "2026-09-22"},
		{"2026-09-22", "2026-09-21"},
		{"2024-02-29", "2024-03-01"},
		{"2023-02-28", "2023-03-01"},
		{"2024-02-29", "2025-02-28"},
		{"1999-12-31", "2000-01-01"},
		{"2026-01-31", "2026-02-28"},
		{"2000-02-29", "2001-02-28"},
		{"2026-09-21", "2041-09-21"},
	}
	for _, pair := range datePairs {
		left, right := pair[0], pair[1]
		wantBetween := int(math.Round(MustParseIsoDate(right).Sub(MustParseIsoDate(left)).Hours() / 24))
		if got := DaysBetween(left, right); got != wantBetween {
			t.Errorf("DaysBetween(%s, %s) = %d, want %d", left, right, got, wantBetween)
		}
		var wantCompare int
		switch {
		case MustParseIsoDate(left).Before(MustParseIsoDate(right)):
			wantCompare = -1
		case MustParseIsoDate(left).After(MustParseIsoDate(right)):
			wantCompare = 1
		}
		if got := CompareIsoDates(left, right); got != wantCompare {
			t.Errorf("CompareIsoDates(%s, %s) = %d, want %d", left, right, got, wantCompare)
		}
	}

	addCases := []struct {
		date   string
		months int
		want   string
	}{
		{"2026-01-31", 1, "2026-02-28"},
		{"2024-01-31", 1, "2024-02-29"},
		{"2024-02-29", 12, "2025-02-28"},
		{"2024-02-29", 1, "2024-03-29"},
		{"2026-09-21", 0, "2026-09-21"},
		{"2026-12-15", 2, "2027-02-15"},
		{"2026-03-31", -1, "2026-02-28"},
		{"2000-01-01", -1, "1999-12-01"},
	}
	for _, tc := range addCases {
		if got := AddMonthsClamped(tc.date, tc.months); got != tc.want {
			t.Errorf("AddMonthsClamped(%s, %d) = %s, want %s", tc.date, tc.months, got, tc.want)
		}
		if got := AddYearsClamped(tc.date, tc.months/12); tc.months%12 == 0 {
			wantYear := AddMonthsClamped(tc.date, tc.months)
			if got != wantYear {
				t.Errorf("AddYearsClamped(%s, %d) = %s, want %s", tc.date, tc.months/12, got, wantYear)
			}
		}
	}
}
