package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/apitest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
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
