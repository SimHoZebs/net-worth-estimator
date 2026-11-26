package domain

import "testing"

func TestExportStochasticSamplesRetainsProjectedAndOmitsHistoricalOnly(t *testing.T) {
	session := &stochasticSession{
		sortedValuesByDate: map[string][]float64{
			"2026-01-01": {10, 20},
			"2026-01-02": {30},
		},
		isHistoricalByDate: map[string]bool{"2026-01-01": false, "2026-01-02": true},
	}
	got := exportStochasticSamples(session)
	if len(got) != 1 || len(got["2026-01-01"]) != 2 || got["2026-01-02"] != nil {
		t.Fatalf("samples = %+v, want the same-day projected date and without a historical-only date", got)
	}
}
