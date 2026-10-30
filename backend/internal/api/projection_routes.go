package api

import "github.com/danielgtaylor/huma/v2"

func (s *Server) registerProjectionRoutes(api huma.API) {
	compute := huma.NewGroup(api, "/v1")
	compute.UseSimpleModifier(func(op *huma.Operation) {
		if op.Metadata == nil {
			op.Metadata = map[string]any{}
		}
		op.Metadata[operationEffectKey] = operationEffectCompute
	})
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
}
