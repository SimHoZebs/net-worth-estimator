package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync"
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
	if !reflect.DeepEqual(historyOnly.Evaluations, full.Evaluations) {
		t.Fatal("history-only response changed evaluations")
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

func TestDeterministicResponseRangesShareCompleteArtifact(t *testing.T) {
	probe := openAPIStore(t)
	probeHandler := New(probe, Config{})
	full := decodeRangeResult(t, rangeRequest(t, probeHandler, rangeBody(t, fullSpanRange())))
	mid := full.Timeline.Rows[len(full.Timeline.Rows)/2].Date

	database := openAPIStore(t)
	handler := New(database, Config{})
	first := rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(mid)}))
	if got := first.Header().Get("Cache-Status"); got != cacheStatusMiss {
		t.Fatalf("narrow Cache-Status = %q, want miss", got)
	}
	firstResult := decodeRangeResult(t, first)
	repeated := rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(mid)}))
	if got := repeated.Header().Get("Cache-Status"); got != cacheStatusHit {
		t.Fatalf("repeated range Cache-Status = %q, want hit", got)
	}
	if !reflect.DeepEqual(firstResult, decodeRangeResult(t, repeated)) {
		t.Fatal("response filtering differs between cache miss and hit")
	}
	second := rangeRequest(t, handler, rangeBody(t, fullSpanRange()))
	if got := second.Header().Get("Cache-Status"); got != cacheStatusHit {
		t.Fatalf("full Cache-Status after narrow = %q, want hit", got)
	}
	if !reflect.DeepEqual(full, decodeRangeResult(t, second)) {
		t.Fatal("date filtering changed the stored complete result")
	}
}

// An end date at or past the last timeline row returns the full payload:
// this is the contract the default horizon-end range relies on.
func TestDeterministicHorizonEndEqualsFullSpan(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	wide := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, fullSpanRange())))
	last := wide.Timeline.Rows[len(wide.Timeline.Rows)-1].Date
	capped := decodeRangeResult(t, rangeRequest(t, handler, rangeBody(t, &projectionRange{EndDate: string(last)})))
	wideRaw, err := json.Marshal(wide)
	if err != nil {
		t.Fatal(err)
	}
	cappedRaw, err := json.Marshal(capped)
	if err != nil {
		t.Fatal(err)
	}
	if string(wideRaw) != string(cappedRaw) {
		t.Fatal("horizon-end response differs from the full-span response")
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

// Overlapping narrow and full requests share one artifact key on a cold
// store: whichever computes first stores the full result, and every
// response stays correct whether one or two computations run. Workers
// report values, never through t. Run with -race to cover the shared
// backing arrays.
func TestDeterministicOverlappingRangesStayCorrect(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	narrowBody := rangeBody(t, &projectionRange{EndDate: "2026-06-30"})
	fullBody := rangeBody(t, fullSpanRange())

	const workers = 4
	type outcome struct {
		body []byte
		code int
	}
	results := make([]outcome, workers)
	var group sync.WaitGroup
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			body := narrowBody
			if index%2 != 0 {
				body = fullBody
			}
			request := httptest.NewRequest(http.MethodPost, "/v1/projections/deterministic", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			results[index] = outcome{body: response.Body.Bytes(), code: response.Code}
		}(i)
	}
	group.Wait()

	decode := func(index int) *types.ProjectionResult {
		t.Helper()
		if results[index].code != http.StatusOK {
			t.Fatalf("worker %d status = %d, body %s", index, results[index].code, results[index].body)
		}
		var payload struct {
			Result *types.ProjectionResult `json:"result"`
		}
		if err := json.Unmarshal(results[index].body, &payload); err != nil || payload.Result == nil {
			t.Fatalf("worker %d decode failed: %v", index, err)
		}
		return payload.Result
	}
	narrowA, narrowB := decode(0), decode(2)
	fullA, fullB := decode(1), decode(3)
	for _, result := range []*types.ProjectionResult{narrowA, narrowB} {
		for _, row := range result.Timeline.Rows {
			if row.Date > "2026-06-30" {
				t.Fatalf("narrow row %s past end bound", row.Date)
			}
		}
	}
	narrowRawA, _ := json.Marshal(narrowA)
	narrowRawB, _ := json.Marshal(narrowB)
	if string(narrowRawA) != string(narrowRawB) {
		t.Fatal("narrow responses disagree")
	}
	fullRawA, _ := json.Marshal(fullA)
	fullRawB, _ := json.Marshal(fullB)
	if string(fullRawA) != string(fullRawB) {
		t.Fatal("full responses disagree")
	}
	narrowDates := map[string]bool{}
	for _, row := range narrowA.Timeline.Rows {
		narrowDates[string(row.Date)] = true
	}
	for _, row := range fullA.Timeline.Rows {
		if row.Date <= "2026-06-30" && !narrowDates[string(row.Date)] {
			t.Fatalf("full row %s within bound missing from narrow response", row.Date)
		}
	}
}
