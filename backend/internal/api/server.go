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
	// AuthToken guards PUT /v1/financial-model. Empty means auth disabled.
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
			if served, _ := serveFrontendFile(root, "index.html", writer, request); served {
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
		OperationID: "trigger-simplefin-sync",
		Method:      "POST",
		Path:        "/v1/sync/simplefin",
		Summary:     "Run the SimpleFIN sync (balances and pending seed)",
	}, server.triggerSync)

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
