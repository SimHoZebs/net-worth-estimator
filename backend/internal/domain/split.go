package domain

import (
	"errors"
	"fmt"
	"strings"
)

// Split allocation. All amounts are integer minor units (cents, yen, fils).
// The algorithm is UI-independent: SOC-04B (persistence) and SOC-04C (UI)
// consume it without re-deriving shares.

// zeroDecimalCurrencies use 0 minor digits (ISO 4217).
var zeroDecimalCurrencies = map[string]bool{
	"BIF": true, "CLP": true, "DJF": true, "GNF": true, "ISK": true,
	"JPY": true, "KMF": true, "KRW": true, "PYG": true, "RWF": true,
	"UGX": true, "UYI": true, "VND": true, "VUV": true, "XAF": true,
	"XOF": true, "XPF": true,
}

// threeDecimalCurrencies use 3 minor digits (ISO 4217).
var threeDecimalCurrencies = map[string]bool{
	"BHD": true, "IQD": true, "JOD": true, "KWD": true,
	"LYD": true, "OMR": true, "TND": true,
}

// CurrencyMinorDigits reports the minor-unit precision for an ISO 4217
// currency code. Codes are case-insensitive. Any other syntactically valid
// 3-letter code defaults to 2 minor digits.
func CurrencyMinorDigits(currency string) (int, error) {
	code, err := normalizeCurrency(currency)
	if err != nil {
		return 0, err
	}
	switch {
	case zeroDecimalCurrencies[code]:
		return 0, nil
	case threeDecimalCurrencies[code]:
		return 3, nil
	default:
		return 2, nil
	}
}

// MinorUnitsPerMajor reports how many minor units make one major unit
// (100 for USD/EUR, 1 for JPY, 1000 for KWD).
func MinorUnitsPerMajor(currency string) (int64, error) {
	digits, err := CurrencyMinorDigits(currency)
	if err != nil {
		return 0, err
	}
	units := int64(1)
	for i := 0; i < digits; i++ {
		units *= 10
	}
	return units, nil
}

func normalizeCurrency(currency string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(currency))
	if len(code) != 3 {
		return "", fmt.Errorf("invalid currency code %q: want 3 letters", currency)
	}
	for i := 0; i < 3; i++ {
		if code[i] < 'A' || code[i] > 'Z' {
			return "", fmt.Errorf("invalid currency code %q: want 3 letters", currency)
		}
	}
	return code, nil
}

// MajorToMinor parses an exact decimal major-unit amount (for example
// "10.25") into integer minor units using the currency precision. It never
// touches float64, so decimal input stays exact. Excess fraction digits
// round half up. Negative amounts are rejected: splits allocate what is
// owed, never negative shares.
func MajorToMinor(major string, currency string) (int64, error) {
	digits, err := CurrencyMinorDigits(currency)
	if err != nil {
		return 0, err
	}
	text := strings.TrimSpace(major)
	if text == "" {
		return 0, errors.New("invalid amount: empty")
	}
	if strings.HasPrefix(text, "-") {
		return 0, fmt.Errorf("invalid amount %q: negative amounts are rejected", major)
	}
	text = strings.TrimPrefix(text, "+")
	if strings.HasPrefix(text, "-") {
		return 0, fmt.Errorf("invalid amount %q: negative amounts are rejected", major)
	}
	intPart, fracPart := text, ""
	if dot := strings.IndexByte(text, '.'); dot >= 0 {
		if strings.Count(text, ".") > 1 {
			return 0, fmt.Errorf("invalid amount %q: want digits with one optional decimal point", major)
		}
		intPart, fracPart = text[:dot], text[dot+1:]
		if fracPart == "" {
			return 0, fmt.Errorf("invalid amount %q: malformed decimal", major)
		}
	}
	if intPart == "" {
		intPart = "0"
	}
	for _, part := range []string{intPart, fracPart} {
		for i := 0; i < len(part); i++ {
			if part[i] < '0' || part[i] > '9' {
				return 0, fmt.Errorf("invalid amount %q: want digits with one optional decimal point", major)
			}
		}
	}
	units := int64(1)
	for i := 0; i < digits; i++ {
		units *= 10
	}
	var whole int64
	for i := 0; i < len(intPart); i++ {
		digit := int64(intPart[i] - '0')
		if whole > (1<<62-digit)/10 {
			return 0, fmt.Errorf("invalid amount %q: out of range", major)
		}
		whole = whole*10 + digit
	}
	frac := make([]byte, 0, len(fracPart)+1)
	frac = append(frac, fracPart...)
	for len(frac) < digits {
		frac = append(frac, '0')
	}
	var minor int64
	for i := 0; i < digits; i++ {
		minor = minor*10 + int64(frac[i]-'0')
	}
	roundUp := false
	if len(fracPart) > digits && frac[digits] >= '5' {
		roundUp = true
	}
	const maxInt64 = int64(1<<63 - 1)
	if whole > (maxInt64-minor)/units {
		return 0, fmt.Errorf("invalid amount %q: out of range", major)
	}
	total := whole*units + minor
	if roundUp {
		if total == maxInt64 {
			return 0, fmt.Errorf("invalid amount %q: out of range", major)
		}
		total++
	}
	return total, nil
}

// SplitShare is one participant's allocation in integer minor units.
type SplitShare struct {
	ParticipantID string
	AmountMinor   int64
}

// SplitInput describes one allocation request. ParticipantIDs lists the
// initiator plus invitees in a stable order; shares return in that order.
// Overrides, when non-empty, replaces the equal default: it must name an
// amount for every participant and sum exactly to TotalMinor.
type SplitInput struct {
	TotalMinor     int64
	Currency       string
	InitiatorID    string
	ParticipantIDs []string
	Overrides      map[string]int64
}

// AllocateSplit divides TotalMinor across ParticipantIDs. With no overrides
// every participant owes an equal share and the integer-division remainder
// goes to the initiator, so shares always sum exactly to the total.
func AllocateSplit(input SplitInput) ([]SplitShare, error) {
	if _, err := normalizeCurrency(input.Currency); err != nil {
		return nil, err
	}
	if input.TotalMinor < 0 {
		return nil, fmt.Errorf("invalid split total %d: negative totals are rejected", input.TotalMinor)
	}
	if len(input.ParticipantIDs) == 0 {
		return nil, errors.New("invalid split: at least one participant is required")
	}
	if strings.TrimSpace(input.InitiatorID) == "" {
		return nil, errors.New("invalid split: initiator is required")
	}
	seen := make(map[string]bool, len(input.ParticipantIDs))
	initiatorFound := false
	for _, id := range input.ParticipantIDs {
		if strings.TrimSpace(id) == "" {
			return nil, errors.New("invalid split: participant IDs must be non-empty")
		}
		if seen[id] {
			return nil, fmt.Errorf("invalid split: duplicate participant %q", id)
		}
		seen[id] = true
		if id == input.InitiatorID {
			initiatorFound = true
		}
	}
	if !initiatorFound {
		return nil, errors.New("invalid split: initiator must be a participant")
	}

	if len(input.Overrides) > 0 {
		return allocateOverrides(input, seen)
	}

	count := int64(len(input.ParticipantIDs))
	base := input.TotalMinor / count
	remainder := input.TotalMinor % count
	shares := make([]SplitShare, 0, len(input.ParticipantIDs))
	for _, id := range input.ParticipantIDs {
		amount := base
		if id == input.InitiatorID {
			amount += remainder
		}
		shares = append(shares, SplitShare{ParticipantID: id, AmountMinor: amount})
	}
	return shares, nil
}

func allocateOverrides(input SplitInput, participants map[string]bool) ([]SplitShare, error) {
	for id, amount := range input.Overrides {
		if !participants[id] {
			return nil, fmt.Errorf("invalid split override: unknown participant %q", id)
		}
		if amount < 0 {
			return nil, fmt.Errorf("invalid split override for %q: negative amounts are rejected", id)
		}
	}
	if len(input.Overrides) != len(input.ParticipantIDs) {
		return nil, fmt.Errorf(
			"invalid split override: want an amount for every participant (%d), got %d",
			len(input.ParticipantIDs), len(input.Overrides),
		)
	}
	var sum int64
	for _, amount := range input.Overrides {
		sum += amount
	}
	if sum != input.TotalMinor {
		return nil, fmt.Errorf(
			"invalid split override: amounts sum to %d, want exactly the total %d",
			sum, input.TotalMinor,
		)
	}
	shares := make([]SplitShare, 0, len(input.ParticipantIDs))
	for _, id := range input.ParticipantIDs {
		shares = append(shares, SplitShare{ParticipantID: id, AmountMinor: input.Overrides[id]})
	}
	return shares, nil
}
