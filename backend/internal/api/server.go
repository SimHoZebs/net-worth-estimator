// Package api wires the HTTP surface: chi router, huma operations, SSE.
package api

import (
	"context"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Server carries runtime dependencies.
type Server struct {
	Receipts   *receipts.Service
	store      store.Store
	ResourceID string
	CanWrite   func(context.Context) bool
	// ReadOnly rejects canonical model writes with 403. Reads and compute
	// endpoints are unaffected.
	ReadOnly bool
	// SyncRunner runs the SimpleFIN sync on trigger. It may be nil (sample
	// plans, tests) or unconfigured (no Bridge credential); triggers then
	// return 503.
	SyncRunner *simplefin.Runner
}

// Config controls HTTP integration behavior.
type Config struct {
	ReceiptSource *receipts.Source
	// ResourceID namespaces in-flight projections as well as persisted artifacts.
	ResourceID     string
	CanWrite       func(context.Context) bool
	AllowedOrigins []string
	ReadOnly       bool
	// SyncRunner runs the SimpleFIN sync on trigger. It may be nil (sample
	// plans, tests) or unconfigured (no Bridge credential); triggers then
	// return 503.
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
		Receipts:   receipts.NewService(store, serverConfig.ReceiptSource, serverConfig.ResourceID),
		ResourceID: serverConfig.ResourceID,
		CanWrite:   serverConfig.CanWrite,
		store:      store,
		ReadOnly:   serverConfig.ReadOnly,
		SyncRunner: serverConfig.SyncRunner,
	}
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
	documentRawRoutes(api)
	server.registerReceiptRoutes(api)
	server.registerModelRoutes(api)
	server.registerSyncRoutes(api)
	server.registerProjectionRoutes(api)

	huma.Register(api, huma.Operation{
		OperationID: "get-server-status",
		Method:      "GET",
		Path:        "/v1/status",
		Summary:     "Report server write availability and auth state",
	}, server.getStatus)

	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	if serverConfig.FrontendDir != "" {
		router.NotFound(frontendHandler(serverConfig.FrontendDir))
	}

	return router
}
