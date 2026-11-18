package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type Config = api.Config

// New always exercises the real composition root. Namespace disposable stores
// as production users are namespaced, without access to projection internals.
func New(st store.Store, config Config) http.Handler {
	if config.ResourceID == "" {
		config.ResourceID = fmt.Sprintf("test:%p", st)
	}
	return api.New(st, config)
}

var openAPIStore = apitest.OpenStore
var apiProjectRoot = apitest.ProjectRoot
var seedBaseline = apitest.SeedBaseline
var postStochastic = apitest.PostStochastic
var sseEvents = apitest.SSEEvents
var domainValidate = domain.ValidateFinancialModel

func stochasticTestModel() *types.FinancialModel {
	end := "2027-01-01"
	return &types.FinancialModel{
		Accounts:     []types.Account{{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay("checking", "Checking")}},
		Transactions: []types.Transaction{},
		Schedules: []types.Schedule{{
			ID: "salary", Name: "Salary", Destinations: []string{"checking"},
			Amount:    types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}},
			Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", EndDate: &end, Priority: 1, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func stochasticTestBody(t *testing.T, runCount int, seed *int64) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"model": stochasticTestModel(),
		"settings": types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-06-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables(),
		},
		"config": map[string]any{"runCount": runCount, "seed": seed},
	})
	if err != nil {
		t.Fatalf("marshal stochastic body: %v", err)
	}
	return raw
}

const (
	projectionSourceComputed = "computed"
)

// Wire fixtures keep whole-router tests independent of private handler types.
type projectionRange struct {
	StartDate string `json:"startDate,omitempty"`
	EndDate   string `json:"endDate,omitempty"`
}

type projectionRequestBody struct {
	Model     *types.FinancialModel           `json:"model,omitempty"`
	Overrides types.ModelOverrides            `json:"overrides,omitempty"`
	Settings  types.ProjectionRuntimeSettings `json:"settings"`
	Range     *projectionRange                `json:"range,omitempty"`
}

type positionRequestBody struct {
	Model    *types.FinancialModel `json:"model,omitempty"`
	AsOfDate string                `json:"asOfDate"`
}

type presetWriteResult struct {
	Result types.AmountPreset           `json:"value"`
	Issues []types.ModelValidationIssue `json:"issues"`
	Saved  bool                         `json:"saved"`
}

type writeResult[T any] struct {
	Result   T                            `json:"value"`
	Issues   []types.ModelValidationIssue `json:"issues"`
	Saved    bool                         `json:"saved"`
	Revision string                       `json:"revision"`
}

func hasErrorIssues(issues []types.ModelValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == types.SeverityError {
			return true
		}
	}
	return false
}

// seedAPIPattern builds the shared three-observation world for pattern HTTP
// tests: three monthly bank rows through the real sync reconcile plus one
// claim/complete cycle. It replaces seedAPIRecurringPattern and
// seedAPIPaymentPattern so integration has one parameterized seed
// (kind, cadence, description, amount, provider, role).
func seedAPIPattern(t *testing.T, scoped store.Store, kind, cadence, description, amount, provider, role string) []types.AnalysisFinding {
	t.Helper()
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	posted := []int64{
		time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC).Unix(),
		time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC).Unix(),
		time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC).Unix(),
	}
	transactions := make([]simplefin.Transaction, 0, len(posted))
	for i, stamp := range posted {
		transactions = append(transactions, simplefin.Transaction{ID: "pattern-" + string(rune('a'+i)), Description: description, Amount: amount, Posted: stamp})
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(posted[2], 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	analyzer := "payments"
	if kind == "recurring" {
		analyzer = "recurring"
	}
	run, input, claimed, err := scoped.ClaimAnalysis(analyzer, "test-v1")
	if err != nil || !claimed || len(input.Transactions) != 3 {
		t.Fatalf("claim=%v %v %+v", claimed, err, input)
	}
	ids := []string{input.Transactions[0].TransactionID, input.Transactions[1].TransactionID, input.Transactions[2].TransactionID}
	detections := make([]types.AnalysisDetection, 0, len(ids))
	for _, id := range ids {
		detections = append(detections, types.AnalysisDetection{
			TransactionID: id, Kind: kind, Provider: provider, Product: cadence, Role: role, Strength: "moderate",
			Evidence:      []types.AnalysisEvidence{{Code: kind + ".cadence", Reason: "test pattern", TransactionIDs: ids}},
			Pattern:       &types.AnalysisPaymentPattern{PatternID: "pattern-" + kind, Currency: "USD", TypicalAmount: amount},
			JudgmentInput: &types.AnalysisJudgmentInput{ID: "request-" + kind, Kind: kind, PatternID: "pattern-" + kind},
		})
	}
	if err := scoped.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatal(err)
	}
	items, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(items) != 3 {
		t.Fatalf("findings=%+v err=%v", items, err)
	}
	return items
}

func confirmAPIFinding(t *testing.T, handler http.Handler, finding types.AnalysisFinding) {
	t.Helper()
	input := types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: finding.RunID, Action: "confirm"}
	body, _ := json.Marshal(input)
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/analysis-findings/"+finding.ID+"/feedback", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("confirm=%d %s", res.Code, res.Body.String())
	}
}

func callAPI(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	res := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(res, req)
	return res
}
