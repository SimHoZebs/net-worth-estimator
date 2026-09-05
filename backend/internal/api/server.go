// Package api wires the HTTP surface: chi router, huma operations, SSE.
package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Server carries runtime dependencies.
type Server struct {
	store *store.Store
	// ReadOnly rejects canonical model writes with 403. Reads and compute
	// endpoints are unaffected.
	ReadOnly bool
	// AuthEnabled reports whether a bearer token guards writes.
	AuthEnabled bool
}

// Config controls HTTP integration behavior.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
	// AuthToken guards PUT /v1/financial-model. Empty means auth disabled.
	AuthToken string
}

// New builds the chi router with all routes.
func New(store *store.Store, serverConfig Config) http.Handler {
	server := &Server{
		store:       store,
		ReadOnly:    serverConfig.ReadOnly,
		AuthEnabled: serverConfig.AuthToken != "",
	}
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Use(corsMiddleware(serverConfig.AllowedOrigins))
	router.Use(writeAuthMiddleware(serverConfig.ReadOnly, serverConfig.AuthToken))

	config := huma.DefaultConfig("Net Worth Estimator API", "1.0.0")
	api := humachi.New(router, config)

	huma.Register(api, huma.Operation{
		OperationID: "get-financial-model",
		Method:      "GET",
		Path:        "/v1/financial-model",
		Summary:     "Load the canonical financial model with diagnostics",
	}, server.getModel)

	huma.Register(api, huma.Operation{
		OperationID: "put-financial-model",
		Method:      "PUT",
		Path:        "/v1/financial-model",
		Summary:     "Validate and persist the canonical financial model",
	}, server.putModel)

	huma.Register(api, huma.Operation{
		OperationID: "get-server-status",
		Method:      "GET",
		Path:        "/v1/status",
		Summary:     "Report server write availability and auth state",
	}, server.getStatus)

	huma.Register(api, huma.Operation{
		OperationID: "get-income-data",
		Method:      "GET",
		Path:        "/v1/income-data",
		Summary:     "Load the income data snapshot",
	}, server.getIncomeData)

	huma.Register(api, huma.Operation{
		OperationID: "project-deterministic",
		Method:      "POST",
		Path:        "/v1/projections/deterministic",
		Summary:     "Run a deterministic projection",
	}, server.projectDeterministic)

	huma.Register(api, huma.Operation{
		OperationID: "analyze-postings",
		Method:      "POST",
		Path:        "/v1/analyses/postings",
		Summary:     "Run posting-derived analyses (payroll evidence)",
	}, server.analyzePostings)

	// Raw SSE endpoint for stochastic progress streaming.
	router.Post("/v1/projections/stochastic", server.stochasticSSE)

	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	return router
}
