package domain

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestVolatileRateInputOf(t *testing.T) {
	fixed := types.TransactionAmountResolution{Inputs: map[string]types.AmountInputBinding{}}
	if _, found := VolatileRateInputOf(fixed); found {
		t.Fatalf("fixed amount should not be volatile")
	}
	volatile := types.TransactionAmountResolution{Inputs: map[string]types.AmountInputBinding{
		"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07, "volatility": 0.12}},
	}}
	params, found := VolatileRateInputOf(volatile)
	if !found {
		t.Fatalf("volatile amount should be found")
	}
	if params.Volatility != 0.12 || params.AnnualRate != 0.07 {
		t.Fatalf("volatile params mismatch: %+v", params)
	}
	flatRate := types.TransactionAmountResolution{Inputs: map[string]types.AmountInputBinding{
		"rate": {Source: "provider", Provider: "occurrence-rate", Arguments: map[string]any{"annualRate": 0.07}},
	}}
	if _, found := VolatileRateInputOf(flatRate); found {
		t.Fatalf("flat rate without volatility should not be volatile")
	}
}

func TestFindFirstInvalidSlice(t *testing.T) {
	day := func(date string) int64 {
		moment, err := time.Parse("2006-01-02", date)
		if err != nil {
			t.Fatal(err)
		}
		return moment.UTC().Unix()
	}
	slices := []types.ProjectionSlice{
		{ID: "a", FromAt: day("2026-01-01"), ToAt: day("2026-04-01")},
		{ID: "b", FromAt: day("2026-04-01"), ToAt: day("2026-07-01")},
		{ID: "c", FromAt: day("2026-07-01"), ToAt: day("2026-10-01")},
	}
	if got := FindFirstInvalidSlice(slices, 0); got != -1 {
		t.Fatalf("zero dirty should need no rebuild, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, day("2026-05-01")); got != 1 {
		t.Fatalf("expected slice 1, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, day("2026-04-01")); got != 0 {
		t.Fatalf("dirty equal to boundary to_at rebuilds that slice, got %d", got)
	}
	if got := FindFirstInvalidSlice(slices, day("2027-01-01")); got != -1 {
		t.Fatalf("dirty past end should need no rebuild, got %d", got)
	}
}
