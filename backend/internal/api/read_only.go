package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

const operationEffectKey = "effect"
const operationEffectCompute = "compute"

// readOnlyMiddleware guards matched operations before Huma reads their inputs.
// Mutations are writes by default. Compute operations opt out at registration.
// The outer identity boundary still owns authentication and user permissions.
func readOnlyMiddleware(api huma.API, readOnly bool) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		if !readOnly {
			next(ctx)
			return
		}
		switch ctx.Operation().Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next(ctx)
			return
		}
		if ctx.Operation().Metadata[operationEffectKey] == operationEffectCompute {
			next(ctx)
			return
		}
		_ = huma.WriteErr(api, ctx, http.StatusForbidden, "server is read-only")
	}
}
