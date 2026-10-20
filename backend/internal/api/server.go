// Package api wires the HTTP surface: chi router, huma operations, SSE.
package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Server carries runtime dependencies.
type Server struct {
	store store.Store
	// ReadOnly rejects canonical model writes with 403. Reads and compute
	// endpoints are unaffected.
	ReadOnly bool
	// AuthEnabled reports whether a bearer token guards writes.
	AuthEnabled bool
	// SyncRunner runs the SimpleFIN sync on trigger. Nil when unconfigured.
	SyncRunner *simplefin.Runner
}

// Config controls HTTP integration behavior.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
	// AuthToken guards row writes. Empty means auth disabled.
	AuthToken string
	// SyncRunner runs the SimpleFIN sync on trigger. Nil when unconfigured.
	SyncRunner  *simplefin.Runner
	FrontendDir string
}

func isBackendPath(requestPath string) bool {
	return requestPath == "/v1" || strings.HasPrefix(requestPath, "/v1/") ||
		requestPath == "/healthz" || strings.HasPrefix(requestPath, "/healthz/") ||
		requestPath == "/docs" || strings.HasPrefix(requestPath, "/docs/") ||
		strings.HasPrefix(requestPath, "/openapi") ||
		requestPath == "/schemas" || strings.HasPrefix(requestPath, "/schemas/")
}

func cleanFrontendRequestPath(requestPath string) (string, bool) {
	if strings.ContainsRune(requestPath, '\x00') || strings.ContainsRune(requestPath, '\\') {
		return "", false
	}
	for _, segment := range strings.Split(requestPath, "/") {
		if segment == ".." {
			return "", false
		}
	}
	return path.Clean("/" + requestPath), true
}

func serveFrontendFile(root *os.Root, name string, writer http.ResponseWriter, request *http.Request) (bool, bool) {
	file, err := root.Open(name)
	if err != nil {
		return false, os.IsNotExist(err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return false, false
	}
	if info.IsDir() {
		return serveFrontendFile(root, path.Join(name, "index.html"), writer, request)
	}
	if !info.Mode().IsRegular() {
		return false, true
	}
	http.ServeContent(writer, request, path.Base(name), info.ModTime(), file)
	return true, true
}

// serveFrontendMissingPage serves the bundled 404 page with a 404 status.
// Unknown page routes show that page (which redirects back to the app)
// instead of silently serving the index. Missing assets keep the plain
// 404 below so bad asset URLs never return HTML.
func serveFrontendMissingPage(root *os.Root, writer http.ResponseWriter, request *http.Request) bool {
	file, err := root.Open("404.html")
	if err != nil {
		return false
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || info.IsDir() || !info.Mode().IsRegular() {
		return false
	}
	writer.WriteHeader(http.StatusNotFound)
	http.ServeContent(writer, request, "404.html", info.ModTime(), file)
	return true
}

func frontendHandler(frontendDir string) http.HandlerFunc {
	frontendDir = filepath.Clean(frontendDir)
	return func(writer http.ResponseWriter, request *http.Request) {
		if isBackendPath(request.URL.Path) || (request.Method != http.MethodGet && request.Method != http.MethodHead) {
			http.NotFound(writer, request)
			return
		}

		requestPath, ok := cleanFrontendRequestPath(request.URL.Path)
		if !ok {
			http.NotFound(writer, request)
			return
		}
		root, err := os.OpenRoot(frontendDir)
		if err != nil {
			http.NotFound(writer, request)
			return
		}
		defer root.Close()

		fileName := strings.TrimPrefix(requestPath, "/")
		if fileName == "" {
			fileName = "index.html"
		}
		served, missing := serveFrontendFile(root, fileName, writer, request)
		if served {
			return
		}
		if !missing {
			http.NotFound(writer, request)
			return
		}
		if path.Ext(requestPath) == "" && !strings.HasPrefix(requestPath, "/assets/") {
			if serveFrontendMissingPage(root, writer, request) {
				return
			}
		}
		http.NotFound(writer, request)
	}
}

// New builds the chi router with all routes.
func New(store store.Store, serverConfig Config) http.Handler {
	server := &Server{
		store:       store,
		ReadOnly:    serverConfig.ReadOnly,
		AuthEnabled: serverConfig.AuthToken != "",
		SyncRunner:  serverConfig.SyncRunner,
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

	huma.Register(api, huma.Operation{OperationID: "create-account", Method: "POST", Path: "/v1/accounts", Summary: "Create one account"}, server.createAccount)
	huma.Register(api, huma.Operation{OperationID: "update-account", Method: "PATCH", Path: "/v1/accounts/{id}", Summary: "Replace one account"}, server.updateAccount)
	huma.Register(api, huma.Operation{OperationID: "delete-account", Method: "DELETE", Path: "/v1/accounts/{id}", Summary: "Delete one account"}, server.deleteAccount)
	huma.Register(api, huma.Operation{OperationID: "move-account", Method: "POST", Path: "/v1/accounts/reorder", Summary: "Move one account"}, server.moveAccount)
	huma.Register(api, huma.Operation{OperationID: "create-posting", Method: "POST", Path: "/v1/postings", Summary: "Create one posting"}, server.createPosting)
	huma.Register(api, huma.Operation{OperationID: "update-posting", Method: "PATCH", Path: "/v1/postings/{id}", Summary: "Replace one posting"}, server.updatePosting)
	huma.Register(api, huma.Operation{OperationID: "delete-posting", Method: "DELETE", Path: "/v1/postings/{id}", Summary: "Delete one posting"}, server.deletePosting)
	huma.Register(api, huma.Operation{OperationID: "move-posting", Method: "POST", Path: "/v1/postings/reorder", Summary: "Move one posting"}, server.movePosting)
	huma.Register(api, huma.Operation{OperationID: "create-rule", Method: "POST", Path: "/v1/recurrence-rules", Summary: "Create one recurrence rule"}, server.createRule)
	huma.Register(api, huma.Operation{OperationID: "update-rule", Method: "PATCH", Path: "/v1/recurrence-rules/{id}", Summary: "Replace one recurrence rule"}, server.updateRule)
	huma.Register(api, huma.Operation{OperationID: "delete-rule", Method: "DELETE", Path: "/v1/recurrence-rules/{id}", Summary: "Delete one recurrence rule"}, server.deleteRule)
	huma.Register(api, huma.Operation{OperationID: "move-rule", Method: "POST", Path: "/v1/recurrence-rules/reorder", Summary: "Move one recurrence rule"}, server.moveRule)
	huma.Register(api, huma.Operation{OperationID: "save-checkpoint", Method: "POST", Path: "/v1/checkpoints", Summary: "Upsert one balance checkpoint"}, server.saveCheckpoint)
	huma.Register(api, huma.Operation{OperationID: "delete-checkpoint", Method: "DELETE", Path: "/v1/checkpoints", Summary: "Delete one balance checkpoint"}, server.deleteCheckpoint)
	huma.Register(api, huma.Operation{OperationID: "create-evaluation", Method: "POST", Path: "/v1/evaluations", Summary: "Create one evaluation"}, server.createEvaluation)
	huma.Register(api, huma.Operation{OperationID: "update-evaluation", Method: "PATCH", Path: "/v1/evaluations/{instanceId}", Summary: "Replace one evaluation"}, server.updateEvaluation)
	huma.Register(api, huma.Operation{OperationID: "delete-evaluation", Method: "DELETE", Path: "/v1/evaluations/{instanceId}", Summary: "Delete one evaluation"}, server.deleteEvaluation)
	huma.Register(api, huma.Operation{OperationID: "move-evaluation", Method: "POST", Path: "/v1/evaluations/reorder", Summary: "Move one evaluation"}, server.moveEvaluation)
	huma.Register(api, huma.Operation{OperationID: "list-amount-presets", Method: "GET", Path: "/v1/amount-presets", Summary: "List saved amount recipes"}, server.listPresets)
	huma.Register(api, huma.Operation{OperationID: "create-amount-preset", Method: "POST", Path: "/v1/amount-presets", Summary: "Create one amount recipe"}, server.createPreset)
	huma.Register(api, huma.Operation{OperationID: "update-amount-preset", Method: "PATCH", Path: "/v1/amount-presets/{id}", Summary: "Replace one amount recipe"}, server.updatePreset)
	huma.Register(api, huma.Operation{OperationID: "delete-amount-preset", Method: "DELETE", Path: "/v1/amount-presets/{id}", Summary: "Delete one amount recipe"}, server.deletePreset)
	huma.Register(api, huma.Operation{OperationID: "move-amount-preset", Method: "POST", Path: "/v1/amount-presets/reorder", Summary: "Move one amount recipe"}, server.movePreset)
	huma.Register(api, huma.Operation{OperationID: "save-payment-terms", Method: "POST", Path: "/v1/payment-terms", Summary: "Upsert payment terms for one account"}, server.savePaymentTerms)
	huma.Register(api, huma.Operation{OperationID: "delete-payment-terms", Method: "DELETE", Path: "/v1/payment-terms/{accountId}", Summary: "Delete payment terms for one account"}, server.deletePaymentTerms)
	huma.Register(api, huma.Operation{OperationID: "list-account-links", Method: "GET", Path: "/v1/sync/simplefin/accounts", Summary: "List bridge-to-model account links"}, server.listAccountLinks)
	huma.Register(api, huma.Operation{OperationID: "get-pinned-evaluations", Method: "GET", Path: "/v1/pinned-evaluations", Summary: "List pinned evaluation instance IDs"}, server.getPinnedEvaluations)
	huma.Register(api, huma.Operation{OperationID: "set-pinned-evaluations", Method: "PUT", Path: "/v1/pinned-evaluations", Summary: "Replace pinned evaluation instance IDs"}, server.setPinnedEvaluations)
	huma.Register(api, huma.Operation{OperationID: "save-account-link", Method: "PUT", Path: "/v1/sync/simplefin/accounts/{bridgeAccountId}", Summary: "Link one bridge account"}, server.saveAccountLink)
	huma.Register(api, huma.Operation{OperationID: "delete-account-link", Method: "DELETE", Path: "/v1/sync/simplefin/accounts/{bridgeAccountId}", Summary: "Unlink one bridge account"}, server.deleteAccountLink)

	huma.Register(api, huma.Operation{
		OperationID: "get-server-status",
		Method:      "GET",
		Path:        "/v1/status",
		Summary:     "Report server write availability and auth state",
	}, server.getStatus)

	huma.Register(api, huma.Operation{
		OperationID: "trigger-simplefin-sync",
		Method:      "POST",
		Path:        "/v1/sync/simplefin",
		Summary:     "Run the SimpleFIN sync (balances and pending seed)",
	}, server.triggerSync)

	huma.Register(api, huma.Operation{
		OperationID: "get-amount-resolvers",
		Method:      "GET",
		Path:        "/v1/amount-resolvers",
		Summary:     "List registered amount resolvers and providers",
	}, server.getAmountResolvers)

	huma.Register(api, huma.Operation{
		OperationID: "project-deterministic",
		Method:      "POST",
		Path:        "/v1/projections/deterministic",
		Summary:     "Run a deterministic projection",
	}, server.projectDeterministic)

	// Raw SSE endpoint for stochastic progress streaming.
	router.Post("/v1/projections/stochastic", server.stochasticSSE)

	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	if serverConfig.FrontendDir != "" {
		router.NotFound(frontendHandler(serverConfig.FrontendDir))
	}

	return router
}
