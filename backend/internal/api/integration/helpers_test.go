package integration

import (
	"fmt"
	"net/http"

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
var stochasticTestModel = apitest.StochasticModel
var stochasticTestBody = apitest.StochasticBody
var postStochastic = apitest.PostStochastic
var sseEvents = apitest.SSEEvents
var domainValidate = domain.ValidateFinancialModel

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
