package projections

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	store      store.Store
	resourceID string
}

// Register adds position and projection operations to a compute-enabled API.
func Register(api huma.API, st store.Store, resourceID string) {
	s := &handler{store: st, resourceID: resourceID}
	compute := huma.NewGroup(api, "/v1")
	huma.Register(compute, huma.Operation{
		OperationID: "project-deterministic",
		Method:      "POST",
		Path:        "/projections/deterministic",
		Summary:     "Run a deterministic projection",
	}, s.projectDeterministic)
	huma.Register(compute, huma.Operation{
		OperationID: "resolve-current-position",
		Method:      "POST",
		Path:        "/position",
		Summary:     "Resolve current balances without a forecast",
	}, s.currentPosition)
	huma.Register(compute, huma.Operation{
		OperationID: "project-stochastic",
		Method:      "POST",
		Path:        "/projections/stochastic",
		// The domain engine validates the model and reports preparation failures
		// as SSE events. Preserve large models and optional/extra JSON fields.
		SkipValidateBody: true,
		MaxBodyBytes:     -1,
		BodyReadTimeout:  -1,
		Responses: map[string]*huma.Response{
			"200": {Description: "Success", Content: map[string]*huma.MediaType{
				"text/event-stream": {Schema: &huma.Schema{Type: "string"}},
			}},
		},
	}, s.stochasticSSE)
}
