package domain

import (
	"testing"
)

func splitSum(shares []SplitShare) int64 {
	var sum int64
	for _, share := range shares {
		sum += share.AmountMinor
	}
	return sum
}

func splitByID(shares []SplitShare) map[string]int64 {
	out := make(map[string]int64, len(shares))
	for _, share := range shares {
		out[share.ParticipantID] = share.AmountMinor
	}
	return out
}

func TestAllocateSplitEqual(t *testing.T) {
	shares, err := AllocateSplit(SplitInput{
		TotalMinor:     1000,
		Currency:       "USD",
		InitiatorID:    "alice",
		ParticipantIDs: []string{"alice", "bob", "cara", "dan"},
	})
	if err != nil {
		t.Fatalf("AllocateSplit error: %v", err)
	}
	byID := splitByID(shares)
	for _, id := range []string{"alice", "bob", "cara", "dan"} {
		if byID[id] != 250 {
			t.Fatalf("participant %s = %d, want 250", id, byID[id])
		}
	}
	if sum := splitSum(shares); sum != 1000 {
		t.Fatalf("shares sum to %d, want 1000", sum)
	}
}

func TestAllocateSplitPennyRemainderToInitiator(t *testing.T) {
	shares, err := AllocateSplit(SplitInput{
		TotalMinor:     100,
		Currency:       "USD",
		InitiatorID:    "alice",
		ParticipantIDs: []string{"alice", "bob", "cara"},
	})
	if err != nil {
		t.Fatalf("AllocateSplit error: %v", err)
	}
	byID := splitByID(shares)
	if byID["alice"] != 34 || byID["bob"] != 33 || byID["cara"] != 33 {
		t.Fatalf("penny split = %v, want alice 34, bob 33, cara 33", byID)
	}
	if sum := splitSum(shares); sum != 100 {
		t.Fatalf("shares sum to %d, want 100", sum)
	}
	// Order follows the participant list, so output is deterministic.
	for i, id := range []string{"alice", "bob", "cara"} {
		if shares[i].ParticipantID != id {
			t.Fatalf("shares[%d] = %s, want %s", i, shares[i].ParticipantID, id)
		}
	}
}

func TestAllocateSplitMultiCurrency(t *testing.T) {
	// JPY has no minor units: 100 yen across 3 splits 34/33/33.
	yen, err := AllocateSplit(SplitInput{
		TotalMinor:     100,
		Currency:       "JPY",
		InitiatorID:    "alice",
		ParticipantIDs: []string{"alice", "bob", "cara"},
	})
	if err != nil {
		t.Fatalf("AllocateSplit JPY error: %v", err)
	}
	if byID := splitByID(yen); byID["alice"] != 34 || byID["bob"] != 33 || byID["cara"] != 33 {
		t.Fatalf("yen split = %v, want alice 34, bob 33, cara 33", byID)
	}
	// KWD has three decimals: 1000 fils across 3 splits 334/333/333.
	fils, err := AllocateSplit(SplitInput{
		TotalMinor:     1000,
		Currency:       "KWD",
		InitiatorID:    "bob",
		ParticipantIDs: []string{"alice", "bob", "cara"},
	})
	if err != nil {
		t.Fatalf("AllocateSplit KWD error: %v", err)
	}
	if byID := splitByID(fils); byID["alice"] != 333 || byID["bob"] != 334 || byID["cara"] != 333 {
		t.Fatalf("fils split = %v, want initiator bob 334, others 333", byID)
	}
	if sum := splitSum(fils); sum != 1000 {
		t.Fatalf("fils shares sum to %d, want 1000", sum)
	}
}

func TestAllocateSplitEdgeCases(t *testing.T) {
	// One participant keeps the whole total.
	solo, err := AllocateSplit(SplitInput{
		TotalMinor: 777, Currency: "EUR", InitiatorID: "alice", ParticipantIDs: []string{"alice"},
	})
	if err != nil {
		t.Fatalf("solo AllocateSplit error: %v", err)
	}
	if len(solo) != 1 || solo[0].AmountMinor != 777 {
		t.Fatalf("solo split = %+v, want [{alice 777}]", solo)
	}
	// Zero total splits to zero shares.
	zero, err := AllocateSplit(SplitInput{
		TotalMinor: 0, Currency: "USD", InitiatorID: "alice", ParticipantIDs: []string{"alice", "bob"},
	})
	if err != nil {
		t.Fatalf("zero AllocateSplit error: %v", err)
	}
	if sum := splitSum(zero); sum != 0 {
		t.Fatalf("zero shares sum to %d, want 0", sum)
	}
	// Two allocations of the same input agree exactly.
	first, _ := AllocateSplit(SplitInput{
		TotalMinor: 999, Currency: "USD", InitiatorID: "bob", ParticipantIDs: []string{"alice", "bob", "cara"},
	})
	second, _ := AllocateSplit(SplitInput{
		TotalMinor: 999, Currency: "USD", InitiatorID: "bob", ParticipantIDs: []string{"alice", "bob", "cara"},
	})
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("allocation is not deterministic: %+v vs %+v", first, second)
		}
	}
	if byID := splitByID(first); byID["bob"] != 333 || byID["alice"] != 333 || byID["cara"] != 333 {
		t.Fatalf("999/3 split = %v, want 333 each", byID)
	}
}

func TestAllocateSplitOverrides(t *testing.T) {
	shares, err := AllocateSplit(SplitInput{
		TotalMinor:     1000,
		Currency:       "USD",
		InitiatorID:    "alice",
		ParticipantIDs: []string{"alice", "bob", "cara"},
		Overrides:      map[string]int64{"alice": 500, "bob": 300, "cara": 200},
	})
	if err != nil {
		t.Fatalf("override AllocateSplit error: %v", err)
	}
	byID := splitByID(shares)
	if byID["alice"] != 500 || byID["bob"] != 300 || byID["cara"] != 200 {
		t.Fatalf("override split = %v, want 500/300/200", byID)
	}
}

func TestAllocateSplitRejects(t *testing.T) {
	valid := SplitInput{
		TotalMinor: 1000, Currency: "USD", InitiatorID: "alice",
		ParticipantIDs: []string{"alice", "bob"},
	}
	cases := []struct {
		name   string
		mutate func(*SplitInput)
	}{
		{"negative total", func(in *SplitInput) { in.TotalMinor = -1 }},
		{"bad currency", func(in *SplitInput) { in.Currency = "US" }},
		{"empty currency", func(in *SplitInput) { in.Currency = "" }},
		{"no participants", func(in *SplitInput) { in.ParticipantIDs = nil }},
		{"empty initiator", func(in *SplitInput) { in.InitiatorID = "" }},
		{"initiator outside participants", func(in *SplitInput) { in.InitiatorID = "mallory" }},
		{"duplicate participant", func(in *SplitInput) { in.ParticipantIDs = []string{"alice", "alice"} }},
		{"empty participant", func(in *SplitInput) { in.ParticipantIDs = []string{"alice", ""} }},
		{"override sum short", func(in *SplitInput) {
			in.Overrides = map[string]int64{"alice": 500, "bob": 499}
		}},
		{"override sum over", func(in *SplitInput) {
			in.Overrides = map[string]int64{"alice": 500, "bob": 501}
		}},
		{"override negative", func(in *SplitInput) {
			in.Overrides = map[string]int64{"alice": 1500, "bob": -500}
		}},
		{"override unknown participant", func(in *SplitInput) {
			in.Overrides = map[string]int64{"alice": 500, "mallory": 500}
		}},
		{"override missing participant", func(in *SplitInput) {
			in.Overrides = map[string]int64{"alice": 1000}
		}},
	}
	for _, tc := range cases {
		input := valid
		tc.mutate(&input)
		if _, err := AllocateSplit(input); err == nil {
			t.Fatalf("%s: invalid split was accepted", tc.name)
		}
	}
}
