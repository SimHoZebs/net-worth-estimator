package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestAnalysisReadsArePassiveAndReviewDoesNotChangeModel(t *testing.T) {
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", Currency: "USD", Balance: "100", BalanceDate: 1785628800, Transactions: []simplefin.Transaction{{ID: "charge", Description: "KLARNA PAY IN 4", Amount: "-25", Posted: 1785628800}}}}}
	plan, err := simplefin.Map(set, map[string]string{"bank": "checking"}, time.Unix(1785628800, 0))
	if err != nil {
		t.Fatal(err)
	}
	directives := simplefin.Reconcile(plan.Pending, plan.Settled, nil, map[string]bool{"checking": true})
	if _, err := scoped.ApplySyncPlan(nil, directives); err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{})
	request := func(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(response, req)
		return response
	}
	for _, path := range []string{"/v1/analyses", "/v1/analysis-findings"} {
		response := request(handler, "GET", path, "")
		if response.Code != 200 || response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("GET %s=%d %s", path, response.Code, response.Body.String())
		}
	}
	runs, _, _ := scoped.ListAnalysisRuns()
	if len(runs) != 0 {
		t.Fatal("GET ran analysis")
	}
	doc, _ := scoped.LoadDocument()
	before, _ := store.DocumentETag(doc)
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-10-20", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
	deterministic, _ := json.Marshal(projectionRequestBody{Settings: settings, Range: fullSpanRange()})
	seed := int64(42)
	stochastic, _ := json.Marshal(map[string]any{"settings": settings, "config": types.StochasticConfig{RunCount: 3, Seed: &seed}})
	base := rangeRequest(t, handler, deterministic)
	rangeBase := postStochastic(t, handler, stochastic)
	if base.Code != 200 || rangeBase.Code != 200 {
		t.Fatal("projection fixture failed")
	}
	run, input, claimed, err := scoped.ClaimAnalysis("bnpl", analysis.BNPLVersion)
	if err != nil || !claimed {
		t.Fatalf("claim %v %v", claimed, err)
	}
	findings, err := (analysis.BNPL{}).Analyze(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err := scoped.CompleteAnalysis(run, findings, ""); err != nil {
		t.Fatal(err)
	}
	response := request(handler, "GET", "/v1/analysis-findings?postingIds="+input.Transactions[0].PostingID, "")
	var output struct {
		Findings []types.AnalysisFinding `json:"findings"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &output) != nil || len(output.Findings) != 1 {
		t.Fatalf("findings %d %s", response.Code, response.Body.String())
	}
	id := output.Findings[0].ID
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		if response := request(New(scoped, config), "PATCH", "/v1/analysis-findings/"+id, `{"dismissed":true}`); response.Code != 403 {
			t.Fatalf("guard=%d %s", response.Code, response.Body.String())
		}
	}
	if response := request(handler, "PATCH", "/v1/analysis-findings/"+id, `{"dismissed":true}`); response.Code != 200 {
		t.Fatalf("review=%d %s", response.Code, response.Body.String())
	}
	if response := request(handler, "PATCH", "/v1/analysis-findings/missing", `{"dismissed":true}`); response.Code != 404 {
		t.Fatalf("missing=%d", response.Code)
	}
	doc, _ = scoped.LoadDocument()
	after, _ := store.DocumentETag(doc)
	if before != after || len(doc.RecurrenceRules) != 0 {
		t.Fatal("analysis mutated model")
	}
	next := rangeRequest(t, handler, deterministic)
	if next.Header().Get("Projection-Source") != projectionSourceStored || next.Body.String() != base.Body.String() {
		t.Fatal("analysis changed deterministic output or artifact identity")
	}
	rangeNext := postStochastic(t, handler, stochastic)
	if rangeNext.Header().Get("Projection-Source") != projectionSourceStored || !strings.Contains(rangeNext.Body.String(), sseEvents(t, rangeBase.Body.String())["result"][0]) {
		t.Fatal("analysis changed seeded stochastic output or artifact identity")
	}
}
