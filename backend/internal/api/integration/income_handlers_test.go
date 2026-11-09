package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestIncomeModelRevisionIsReviewableThroughPassiveAPIReads(t *testing.T) {
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var transactions []simplefin.Transaction
	for _, day := range []int{2, 16, 30} {
		transactions = append(transactions, simplefin.Transaction{ID: strconv.Itoa(day), Description: "ACME PAYROLL", Amount: "2000", Posted: time.Date(2026, 1, day, 12, 0, 0, 0, time.UTC).Unix()})
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "conn", Currency: "USD", Balance: "6000", Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("conn", "bank"): "checking"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("payments", (analysis.PaymentPatterns{}).Version()+"/shared-generation:2")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	findings, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err := scoped.CompleteAnalysis(run, findings, ""); err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/analysis-findings", nil))
	var output struct {
		Findings []types.AnalysisFinding `json:"findings"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &output) != nil || len(output.Findings) != 3 {
		t.Fatalf("findings=%s", response.Body.String())
	}
	for _, finding := range output.Findings {
		if finding.Stale {
			t.Fatal("current model revision was treated as an obsolete algorithm")
		}
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/analyses", nil))
	var statuses struct {
		Analyses []struct{ Type, State string } `json:"analyses"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &statuses) != nil {
		t.Fatal(response.Body.String())
	}
	for _, status := range statuses.Analyses {
		if status.Type == "income" && status.State != "succeeded" {
			t.Fatalf("income state=%s", status.State)
		}
	}
}
