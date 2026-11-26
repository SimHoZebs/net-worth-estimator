package domain

import "testing"

func TestExportStochasticSamplesRetainsSameDayHistoricalAndProjected(t *testing.T) {
	session := &stochasticSession{
		sortedValuesByDate: map[string][]float64{"2026-01-01": {10, 20}},
		isHistoricalByDate: map[string]bool{"2026-01-01": true},
		projectedDates:     map[string]bool{"2026-01-01": true},
	}
	got := exportStochasticSamples(session)
	if len(got) != 1 || len(got["2026-01-01"]) != 2 {
		t.Fatalf("samples = %+v, want the same-day projected date retained", got)
	}
}
