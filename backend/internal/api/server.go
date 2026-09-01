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
	// Seed paths used by reset; CSV files remain the bundled source snapshot.
	SeedModelPath  string
	SeedIncomePath string
}

// Config controls HTTP integration behavior and bundled reset sources.
type Config struct {
	SeedModelPath  string
	SeedIncomePath string
	AllowedOrigins []string
}

// New builds the chi router with all routes.
func New(store *store.Store, serverConfig Config) http.Handler {
	server := &Server{
		store:          store,
		SeedModelPath:  serverConfig.SeedModelPath,
		SeedIncomePath: serverConfig.SeedIncomePath,
	}
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Use(corsMiddleware(serverConfig.AllowedOrigins))

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
		OperationID: "reset-financial-model",
		Method:      "POST",
		Path:        "/v1/financial-model/reset",
		Summary:     "Reset the canonical model to the bundled CSV source",
	}, server.resetModel)

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
