// Package api wires the HTTP surface: chi router, huma operations, SSE.
package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api/analyses"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/projections"
	receipthttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/receipts"
	synchttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/sync"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Config controls HTTP integration behavior.
type Config struct {
	ReceiptSource *receipts.Source
	// ResourceID namespaces in-flight projections as well as persisted artifacts.
	ResourceID     string
	CanWrite       func(context.Context) bool
	Actor          func(context.Context) string
	AllowedOrigins []string
	ReadOnly       bool
	// SyncRunner runs the SimpleFIN sync on trigger. It may be nil (public
	// probes, non-owner scopes, tests) or unconfigured (no Bridge credential);
	// triggers then return 503.
	SyncRunner *simplefin.Runner
}

// New builds the chi router with all routes.
func New(st store.Store, serverConfig Config) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Use(corsMiddleware(serverConfig.AllowedOrigins))
	// Compress JSON payloads (8 MB deterministic results gzip to ~400 KB).
	// text/event-stream is not a compressible type, so stochastic SSE
	// streams pass through uncompressed with flushing intact.
	router.Use(middleware.Compress(5, "application/json"))
	config := huma.DefaultConfig("Net Worth Estimator API", "1.0.0")
	// Registry naming must satisfy the OpenAPI Components key rule or code
	// generators reject the served spec. Name at registration so every $ref
	// stays consistent; wire schemas are unchanged.
	if config.Components == nil {
		config.Components = &huma.Components{}
	}
	config.Components.Schemas = huma.NewMapRegistry("#/components/schemas/", waypointSchemaNamer)
	api := humachi.New(router, config)
	api.UseMiddleware(readOnlyMiddleware(api, serverConfig.ReadOnly))
	modelRawRoutes(api)
	receiptService := receipts.NewService(st, serverConfig.ReceiptSource, serverConfig.ResourceID)
	receipthttp.Register(api, receiptService, st)
	analyses.Register(api, st, serverConfig.CanWrite, serverConfig.Actor)
	model.Register(api, st, receiptService, serverConfig.ReadOnly)
	synchttp.Register(api, st, serverConfig.SyncRunner)
	compute := huma.NewGroup(api)
	compute.UseSimpleModifier(func(op *huma.Operation) {
		if op.Metadata == nil {
			op.Metadata = map[string]any{}
		}
		op.Metadata[operationEffectKey] = operationEffectCompute
	})
	projections.Register(compute, st, serverConfig.ResourceID)
	registerStatus(api, st, serverConfig)

	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	return router
}
