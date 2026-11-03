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
	gmailhttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/gmail"
	integrationshttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/integrations"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/model"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/projections"
	receipthttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/receipts"
	synchttp "github.com/simhozebs/net-worth-estimator/backend/internal/api/sync"
	gmailservice "github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrations"
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
	// GmailService owns the Gmail OAuth connection. It may be nil
	// (tests, scopes without Gmail); Gmail endpoints then report the
	// connection state from the store but consent, disconnect, and
	// lookback return 503.
	GmailService *gmailservice.Service
	// GmailFrontendBaseURL receives the OAuth post-callback redirect with
	// the connection outcome as query parameters.
	GmailFrontendBaseURL string
}

// New builds the chi router with all routes.
func New(st store.Store, serverConfig Config) http.Handler {
	router := chi.NewRouter()
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
	gmailhttp.Register(api, st, serverConfig.GmailService, serverConfig.ReadOnly)
	integrationshttp.Register(api, integrations.NewRegistry(
		integrations.NewSimpleFIN(st, serverConfig.SyncRunner),
		integrations.NewGmail(st, serverConfig.GmailService),
	))
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
	registerClientErrors(router)
	// The Google OAuth redirect is a plain browser GET (code and state
	// arrive as query parameters) that must 302 back to the frontend, so
	// it runs outside Huma next to the health probe. Its contract is
	// described in modelRawRoutes for the generated client.
	router.Get("/v1/integrations/gmail/callback", gmailhttp.CallbackHandler(serverConfig.GmailService, st, serverConfig.GmailFrontendBaseURL, serverConfig.ReadOnly).ServeHTTP)

	return router
}
