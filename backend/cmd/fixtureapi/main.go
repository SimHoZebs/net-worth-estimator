// Command fixtureapi serves the production API over a recorded CSV fixture and
// can restore that baseline on demand. It exists so browser tests exercise the
// real Go engine and the real HTTP surface instead of a client-side stand-in.
//
// It reads the same environment contract as cmd/server. The only addition is
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
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const resetPath = "/__fixture/reset"

func main() {
	host := envOr("HOST", "127.0.0.1")
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", filepath.Join(os.TempDir(), "waypoint-fixture.db"))
	modelPath := envOr("NET_WORTH_ESTIMATOR_MODEL_PATH", "public/configs")
	incomePath := envOr("NET_WORTH_ESTIMATOR_INCOME_PATH", "public/data/income")
	authToken := os.Getenv("NET_WORTH_ESTIMATOR_AUTH_TOKEN")
	allowedOrigins := splitOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))

	database, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer database.Close()

	readOnly := parseBool(os.Getenv("NET_WORTH_ESTIMATOR_READ_ONLY"))
	// A reset must not interleave with an in-flight request holding the store.
	var mu sync.Mutex
	live := &switcher{}

	restore := func(nextReadOnly bool) error {
		mu.Lock()
		defer mu.Unlock()
		if err := database.Clear(); err != nil {
			return fmt.Errorf("clear store: %w", err)
		}
		if _, _, err := database.ImportCSV(modelPath, incomePath); err != nil {
			return fmt.Errorf("import fixture: %w", err)
		}
		readOnly = nextReadOnly
		live.set(api.New(database, api.Config{
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
			AuthToken:      authToken,
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
			"reset":  true,
			"model":  modelPath,
			"income": incomePath,
		})
	}))
	mux.Handle("/", live)

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

func splitOrigins(value string) []string {
	if value == "" {
		return nil
	}
	origins := []string{}
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}
