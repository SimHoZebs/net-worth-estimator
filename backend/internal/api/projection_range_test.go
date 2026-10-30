package api

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestClipProjectionRange(t *testing.T) {
	source := &types.ProjectionResult{
		AccountSummaries: []types.ProjectionAccountSummary{{AccountID: "cash", EndingBalance: 42}},
		Evaluations: types.EvaluationResultTables{
			PostingFulfillment: []types.EvaluationResultEnvelope{{}},
		},
	}
	source.Summary.FinalNetWorth = 42
	source.Totals.ExternalInflowAmount = 10
	source.Milestones.ProjectionStartDate = "2026-02-01"
	for i, date := range []types.IsoDate{"2026-01-01", "2026-02-01", "2026-03-01"} {
		source.Timeline.Rows = append(source.Timeline.Rows, types.ProjectionRow{Date: date, IsHistorical: i == 0})
		source.TransactionEvents = append(source.TransactionEvents, types.TransactionEvent{Date: date})
	}
	before, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		rangeValue projectionRange
		dates      []types.IsoDate
	}{
		{"inclusive bounds", projectionRange{StartDate: "2026-01-01", EndDate: "2026-02-01"}, []types.IsoDate{"2026-01-01", "2026-02-01"}},
		{"open start and history only", projectionRange{EndDate: "2026-01-01"}, []types.IsoDate{"2026-01-01"}},
		{"open end", projectionRange{StartDate: "2026-02-01"}, []types.IsoDate{"2026-02-01", "2026-03-01"}},
		{"single date", projectionRange{StartDate: "2026-02-01", EndDate: "2026-02-01"}, []types.IsoDate{"2026-02-01"}},
		{"empty interval", projectionRange{StartDate: "2027-01-01"}, []types.IsoDate{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			filtered := clipProjectionRange(source, &test.rangeValue)
			rows, events := []types.IsoDate{}, []types.IsoDate{}
			for _, row := range filtered.Timeline.Rows {
				rows = append(rows, row.Date)
			}
			for _, event := range filtered.TransactionEvents {
				events = append(events, event.Date)
			}
			if !reflect.DeepEqual(rows, test.dates) || !reflect.DeepEqual(events, test.dates) {
				t.Fatalf("rows %v, events %v, want %v", rows, events, test.dates)
			}
			// Restore only the selected slices to compare every other result field.
			restored := *filtered
			restored.Timeline.Rows = source.Timeline.Rows
			restored.TransactionEvents = source.TransactionEvents
			if !reflect.DeepEqual(&restored, source) {
				t.Fatal("date filtering changed other result sections")
			}
			// Replacements and appends must not write into the source arrays.
			for i := range filtered.Timeline.Rows {
				filtered.Timeline.Rows[i].Date = "2099-01-01"
			}
			for i := range filtered.TransactionEvents {
				filtered.TransactionEvents[i].Date = "2099-01-01"
			}
			filtered.Timeline.Rows = append(filtered.Timeline.Rows, types.ProjectionRow{})
			filtered.TransactionEvents = append(filtered.TransactionEvents, types.TransactionEvent{})
			after, err := json.Marshal(source)
			if err != nil {
				t.Fatal(err)
			}
			if string(before) != string(after) {
				t.Fatal("date filtering or response slice writes mutated the source")
			}
		})
	}
}
