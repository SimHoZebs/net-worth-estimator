package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// The range parameter clips one cached full result by date: narrowed
// requests share the full artifact instead of computing separately.
// fullSpanRange states the whole timeline explicitly: the endpoint has
// no default range, so tests wanting everything name a span that covers
// any fixture.
func fullSpanRange() *projectionRange {
	return &projectionRange{StartDate: "2000-01-01", EndDate: "2100-01-01"}
}

func rangeRequest(t *testing.T, handler http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func rangeBody(t *testing.T, r *projectionRange) []byte {
	t.Helper()
	fixturePath := filepath.Join(apiProjectRoot(t), "backend", "testdata", "golden", "checkpoints.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read projection fixture: %v", err)
	}
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	raw, err := json.Marshal(projectionRequestBody{Document: fixture.Document, Settings: fixture.Settings, Range: r})
	if err != nil {
		t.Fatalf("encode projection request: %v", err)
	}
	return raw
}

func decodeRangeResult(t *testing.T, response *httptest.ResponseRecorder) *types.ProjectionResult {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result *types.ProjectionResult `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode projection response: %v", err)
	}
	if payload.Result == nil {
		t.Fatal("projection has no result")
	}
	return payload.Result
}

func TestDeterministicRangeClipsOneArtifact(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	full := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, fullSpanRange())))
	if len(full.Timeline.Rows) == 0 || len(full.MovementEvents) == 0 {
		t.Fatal("fixture has no rows or events to clip")
	}
	var histEnd, projStart types.IsoDate
	for _, row := range full.Timeline.Rows {
		if row.IsHistorical {
			histEnd = row.Date
		} else if projStart == "" {
			projStart = row.Date
		}
	}
	if histEnd == "" || projStart == "" {
		t.Fatal("fixture needs both historical and projected rows")
	}
	mid := full.Timeline.Rows[len(full.Timeline.Rows)/2].Date

	before := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(mid)})))
	for _, row := range before.Timeline.Rows {
		if row.Date > mid {
			t.Fatalf("clipped row %s past end %s", row.Date, mid)
		}
	}
	for _, event := range before.MovementEvents {
		if event.Date > mid {
			t.Fatalf("clipped event %s past end %s", event.Date, mid)
		}
	}

	after := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, &projectionRange{StartDate: string(mid)})))
	for _, row := range after.Timeline.Rows {
		if row.Date < mid {
			t.Fatalf("clipped row %s before start %s", row.Date, mid)
		}
	}
	if len(before.Timeline.Rows)+len(after.Timeline.Rows) < len(full.Timeline.Rows) {
		t.Fatalf("clipped rows %d plus %d lose full rows %d", len(before.Timeline.Rows), len(after.Timeline.Rows), len(full.Timeline.Rows))
	}

	historyOnly := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(histEnd)})))
	for _, row := range historyOnly.Timeline.Rows {
		if !row.IsHistorical {
			t.Fatalf("history row %s is not historical", row.Date)
		}
	}
	if len(historyOnly.Evaluations.PostingFulfillment) != 0 || len(historyOnly.Evaluations.NetWorthThreshold) != 0 {
		t.Fatal("history-only slice carries evaluations")
	}
	for _, event := range historyOnly.MovementEvents {
		if event.Date > histEnd {
			t.Fatalf("history event %s past end %s", event.Date, histEnd)
		}
	}
	if !reflect.DeepEqual(historyOnly.Summary, full.Summary) || !reflect.DeepEqual(historyOnly.Totals, full.Totals) || !reflect.DeepEqual(historyOnly.Milestones, full.Milestones) {
		t.Fatal("clipped slice changed summary, totals, or milestones")
	}
	if len(historyOnly.AccountSummaries) != len(full.AccountSummaries) {
		t.Fatal("clipped slice changed account summaries")
	}

	futureOnly := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, &projectionRange{StartDate: string(projStart)})))
	for _, row := range futureOnly.Timeline.Rows {
		if row.IsHistorical {
			t.Fatalf("projected row %s is historical", row.Date)
		}
	}
	if len(futureOnly.Evaluations.PostingFulfillment) == 0 {
		t.Fatal("projected slice lost evaluations")
	}
}

func TestDeterministicNarrowWarmsFullRequest(t *testing.T) {
	probe := openAPIStore(t)
	probeHandler := New(probe, Config{})
	full := decodeRangeResult(t, rangeRequest(t, probeHandler, rangeBody(t, fullSpanRange())))
	mid := full.Timeline.Rows[len(full.Timeline.Rows)/2].Date

	database := openAPIStore(t)
	handler := New(database, Config{})
	first := rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(mid)}))
	if got := first.Header().Get("X-Cache"); got != "miss" {
		t.Fatalf("narrow X-Cache = %q, want miss", got)
	}
	second := rangeRequest(t, handler, rangeBody(t, fullSpanRange()))
	if got := second.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("full X-Cache after narrow = %q, want hit", got)
	}
}

func TestDeterministicRangeRejectsBadIntervals(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	// A missing range fails huma request validation (422); a present
	// but empty or invalid range fails in the handler (400).
	for _, test := range []struct {
		r    *projectionRange
		want int
	}{
		{nil, http.StatusUnprocessableEntity},
		{&projectionRange{}, http.StatusBadRequest},
		{&projectionRange{StartDate: "2026-05-01", EndDate: "2026-01-01"}, http.StatusBadRequest},
		{&projectionRange{StartDate: "not-a-date"}, http.StatusBadRequest},
		{&projectionRange{StartDate: "2026-13-99"}, http.StatusBadRequest},
	} {
		response := rangeRequest(t, handler, rangeBody(t, test.r))
		if response.Code != test.want {
			t.Fatalf("range %+v status = %d, want %d", test.r, response.Code, test.want)
		}
	}
}
