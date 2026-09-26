package domain

import (
	"fmt"
	"time"
)

// Date helpers. All dates are UTC calendar dates
// formatted "YYYY-MM-DD".
//
// Hot-path note: simulation calls CompareIsoDates, DaysBetween,
// ProjectionYearIndex, and AddMonthsClamped millions of times per stochastic
// run. Those use integer math on the validated YYYY-MM-DD shape instead of
// time.Parse/time.Format: the format is fixed-width and zero-padded, so
// lexicographic order is chronological order. time.Parse stays behind
// ParseIsoDate/IsValidIsoDate (input validation) and the daily/weekly
// advanceDate path, which is rare in practice.

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

// splitIsoDate extracts year/month/day numbers from a validated YYYY-MM-DD
// string. Callers must validate with IsValidIsoDate first.
func splitIsoDate(value string) (year, month, day int) {
	year = int(value[0]-'0')*1000 + int(value[1]-'0')*100 + int(value[2]-'0')*10 + int(value[3]-'0')
	month = int(value[5]-'0')*10 + int(value[6]-'0')
	day = int(value[8]-'0')*10 + int(value[9]-'0')
	return year, month, day
}

// daysFromCivil counts days since 1970-01-01 (Howard Hinnant's algorithm).
// Inverting it is unnecessary: only differences are used.
func daysFromCivil(year, month, day int) int {
	if month <= 2 {
		year--
		month += 12
	}
	era := year / 400
	yoe := year - era*400
	doy := (153*(month-3)+2)/5 + day - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

func CompareIsoDates(left, right string) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func DaysBetween(left, right string) int {
	leftYear, leftMonth, leftDay := splitIsoDate(left)
	rightYear, rightMonth, rightDay := splitIsoDate(right)
	return daysFromCivil(rightYear, rightMonth, rightDay) - daysFromCivil(leftYear, leftMonth, leftDay)
}

// ProjectionYearIndex returns floor(daysBetween(start,date)/365).
func ProjectionYearIndex(projectionStartDate, date string) int {
	return DaysBetween(projectionStartDate, date) / 365
}

// AddMonthsClamped adds months keeping day-of-month clamped to the target
// month length (Jan-31 + 1mo -> Feb-28).
func AddMonthsClamped(date string, monthsToAdd int) string {
	year, month, day := splitIsoDate(date)
	nextMonthIndex := (month - 1) + monthsToAdd
	targetYear := year + floorDiv(nextMonthIndex, 12)
	targetMonth := ((nextMonthIndex % 12) + 12) % 12
	lastDay := daysInMonth(targetYear, time.Month(targetMonth+1))
	targetDay := day
	if day > lastDay {
		targetDay = lastDay
	}
	return fmt.Sprintf("%04d-%02d-%02d", targetYear, targetMonth+1, targetDay)
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
