// Command fixtureapi serves the production API over a recorded CSV fixture and
// can restore that baseline on demand. It exists so browser tests exercise the
// real Go engine and the real HTTP surface instead of a client-side stand-in.
//
// This isolated harness intentionally has no identity provider. Its addition is
// POST /__fixture/reset, which clears persisted state, re-imports the fixture,
// and optionally switches the read-only guard. That route belongs to this
// harness and is absent from the production server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

const resetPath = "/__fixture/reset"

// Only this test executable supplies a synthetic, scoped identity without OIDC.
var fixtureResource = authorization.ResourceFor("http://fixture.invalid", "browser-test")

func fixtureHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set(identity.ResourceHeader, fixtureResource.ID)
		if r.Method == http.MethodGet && r.URL.Path == "/v1/auth/session" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"enabled": true, "authenticated": true, "allowed": true,
				"user": map[string]string{"subject": "browser-test", "name": "Browser test"},
				"resource": map[string]any{"id": fixtureResource.ID, "kind": fixtureResource.Kind,
					"permissions": []string{authorization.Read, authorization.Project, authorization.Write}},
			})
			return
		}
		if expected := r.Header.Get(identity.ResourceHeader); expected != "" && expected != fixtureResource.ID {
			identity.WriteResourceChanged(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	host := envOr("HOST", "127.0.0.1")
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", filepath.Join(os.TempDir(), "waypoint-fixture.db"))
	modelPath := envOr("NET_WORTH_ESTIMATOR_MODEL_PATH", "public/configs")
	allowedOrigins, err := api.ParseAllowedOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))
	if err != nil {
		log.Fatalf("configure allowed origins: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		log.Fatalf("create fixture directory: %v", err)
	}
	application, err := sqlite.SetupDatabase(dbPath)
	if err != nil {
		log.Fatalf("open application database: %v", err)
	}
	defer application.Close()
	stopBlobCleanup := application.StartBlobCleanup(context.Background(), func(err error) { log.Printf("blob cleanup: %v", err) })
	defer stopBlobCleanup()
	database, err := application.EnsurePrivatePlan(fixtureResource.ID, "fixture-browser-test", "http://fixture.invalid", "browser-test")
	if err != nil {
		log.Fatalf("ensure fixture plan: %v", err)
	}

	readOnly := parseBool(os.Getenv("NET_WORTH_ESTIMATOR_READ_ONLY"))
	receiptSource, err := receiptmock.New()
	if err != nil {
		log.Fatalf("configure fixture receipt source: %v", err)
	}
	// A reset must not interleave with an in-flight request holding the store.
	var mu sync.Mutex
	live := &switcher{}

	restore := func(nextReadOnly bool) error {
		mu.Lock()
		defer mu.Unlock()
		if err := database.Clear(); err != nil {
			return fmt.Errorf("clear store: %w", err)
		}
		doc, err := csvio.ImportModel(modelPath)
		if err != nil {
			return fmt.Errorf("import fixture: %w", err)
		}
		if _, err := database.ImportDocument(doc); err != nil {
			return fmt.Errorf("import fixture: %w", err)
		}
		readOnly = nextReadOnly
		live.set(api.New(database, api.Config{
			ReceiptSource:  receiptSource,
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
			ResourceID:     fixtureResource.ID,
		}))
		return nil
	}

	if err := restore(readOnly); err != nil {
		log.Fatalf("seed fixture: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle(resetPath, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			ReadOnly *bool `json:"readOnly"`
		}
		if request.Body != nil {
			// An empty body is valid and keeps the current guard setting.
			_ = json.NewDecoder(request.Body).Decode(&body)
		}
		next := readOnly
		if body.ReadOnly != nil {
			next = *body.ReadOnly
		}
		if err := restore(next); err != nil {
			writer.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintln(writer, err)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"reset": true,
			"model": modelPath,
		})
	}))
	mux.Handle("/", fixtureHandler(live))

	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", host, port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE stochastic streams write for the run duration
		IdleTimeout:       120 * time.Second,
	}

	closed := make(chan struct{})
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown: %v", err)
		}
		close(closed)
	}()

	fmt.Printf("fixtureapi listening on %s from %s\n", server.Addr, modelPath)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server: %v", err)
	}
	<-closed
}

// switcher serves whichever API handler the most recent restore installed.
type switcher struct {
	mu      sync.RWMutex
	current http.Handler
}

func (s *switcher) set(handler http.Handler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.current = handler
}

func (s *switcher) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	s.mu.RLock()
	handler := s.current
	s.mu.RUnlock()
	if handler == nil {
		writer.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	handler.ServeHTTP(writer, request)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func parseBool(value string) bool {
	switch value {
	case "1", "true", "TRUE", "yes", "YES":
		return true
	default:
		return false
	}
}
