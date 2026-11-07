package domain

import (
	"errors"
	"fmt"
	"strings"
)

// Split allocation. All amounts are integer minor units (cents, yen, fils).
// The algorithm is UI-independent: SOC-04B (persistence) and SOC-04C (UI)
// consume it without re-deriving shares.

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

// SplitShare is one participant's allocation in integer minor units.
type SplitShare struct {
	ParticipantID string
	AmountMinor   int64
}

// SplitInput describes one allocation request; shares return in ParticipantIDs order.
// Overrides replace the equal default and must sum exactly to TotalMinor.
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
