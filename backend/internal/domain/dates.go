package domain

import (
	"fmt"
	"math"
	"time"
)

// Date helpers ported from utils/date.ts. All dates are UTC calendar dates
// formatted "YYYY-MM-DD".

const msPerDay = 24 * 60 * 60 * 1000

// ParseIsoDate parses a YYYY-MM-DD string as UTC midnight.
func ParseIsoDate(value string) (time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02", value, time.UTC)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid ISO date %q: %w", value, err)
	}
	return t, nil
}

// IsValidIsoDate reports whether value is a well-formed YYYY-MM-DD calendar
// string. User-supplied dates must pass this before any CompareIsoDates call.
func IsValidIsoDate(value string) bool {
	_, err := ParseIsoDate(value)
	return err == nil
}

func MustParseIsoDate(value string) time.Time {
	t, err := ParseIsoDate(value)
	if err != nil {
		panic(err)
	}
	return t
}

func FormatIsoDate(date time.Time) string {
	return date.UTC().Format("2006-01-02")
}

func daysInMonth(year int, month time.Month) int {
	// Day 0 of next month = last day of this month.
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func CompareIsoDates(left, right string) int {
	l := MustParseIsoDate(left)
	r := MustParseIsoDate(right)
	switch {
	case l.Before(r):
		return -1
	case l.After(r):
		return 1
	default:
		return 0
	}
}

func DaysBetween(left, right string) int {
	diff := MustParseIsoDate(right).Sub(MustParseIsoDate(left))
	return int(math.Round(diff.Hours() / 24))
}

// ProjectionYearIndex returns floor(daysBetween(start,date)/365).
func ProjectionYearIndex(projectionStartDate, date string) int {
	return DaysBetween(projectionStartDate, date) / 365
}

// AddMonthsClamped adds months keeping day-of-month clamped to the target
// month length (Jan-31 + 1mo -> Feb-28). Ported from addMonthsClamped.
func AddMonthsClamped(date string, monthsToAdd int) string {
	source := MustParseIsoDate(date)
	year := source.Year()
	month := int(source.Month()) - 1
	day := source.Day()
	nextMonthIndex := month + monthsToAdd
	targetYear := year + floorDiv(nextMonthIndex, 12)
	targetMonth := ((nextMonthIndex % 12) + 12) % 12
	lastDay := daysInMonth(targetYear, time.Month(targetMonth+1))
	targetDay := day
	if day > lastDay {
		targetDay = lastDay
	}
	return FormatIsoDate(time.Date(targetYear, time.Month(targetMonth+1), targetDay, 0, 0, 0, 0, time.UTC))
}

// AddYearsClamped adds years through clamped month addition.
func AddYearsClamped(date string, yearsToAdd int) string {
	return AddMonthsClamped(date, yearsToAdd*12)
}

func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}
