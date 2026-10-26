// Command server runs the net-worth-estimator backend.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// defaultDBPath prefers a durable per-user data directory over os.TempDir,
// which the OS may wipe between reboots.
func defaultDBPath() string {
	if base, err := os.UserConfigDir(); err == nil && base != "" {
		return filepath.Join(base, "net-worth-estimator", "net-worth-estimator.db")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(os.TempDir(), "net-worth-estimator.db")
	}
	return filepath.Join(home, ".local", "share", "net-worth-estimator", "net-worth-estimator.db")
}

// parseAllowedOrigins delegates to the api package so origin validation
// lives with CORS enforcement.
func parseAllowedOrigins(value string) ([]string, error) {
	return api.ParseAllowedOrigins(value)
}

// parseReadOnly reports whether the server must reject canonical model
// writes. Unset or unrecognized values mean writable (dev default).
func parseReadOnly(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func main() {
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	host := envOr("HOST", "127.0.0.1")
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", defaultDBPath())
	frontendPath := envOr("NET_WORTH_ESTIMATOR_FRONTEND_PATH", "")
	allowedOrigins, err := parseAllowedOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))
	if err != nil {
		log.Fatalf("configure allowed origins: %v", err)
	}
	readOnly := parseReadOnly(os.Getenv("NET_WORTH_ESTIMATOR_READ_ONLY"))
	identityConfig, err := identity.FromEnv(os.Getenv)
	if err != nil {
		log.Fatalf("configure identity: %v", err)
	}
	database, err := store.OpenDatabase(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer database.Close()

	resources, err := resourceConfigFromEnv(os.Getenv)
	if err != nil {
		log.Fatalf("configure plan resources: %v", err)
	}
	syncStore, err := bridgeStore(database, identityConfig.Issuer, resources.OwnerSubject, os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL") != "")
	if err != nil {
		log.Fatalf("configure SimpleFIN plan: %v", err)
	}
	syncRunner, syncStop := configureSync(syncStore)
	defer syncStop()

	apiConfig := api.Config{
		AllowedOrigins: allowedOrigins,
		ReadOnly:       readOnly,
		SyncRunner:     syncRunner,
		FrontendDir:    frontendPath,
	}
	handler, closeResources, err := resourceHandler(context.Background(), database, resources, identityConfig, apiConfig)
	if err != nil {
		log.Fatalf("configure resource access: %v", err)
	}
	defer closeResources()
	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", host, port),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE stochastic streams write for the run duration
		IdleTimeout:       120 * time.Second,
	}

	shutdownComplete := make(chan struct{})
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown: %v", err)
		}
		close(shutdownComplete)
	}()

	fmt.Printf("listening on %s\n", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server: %v", err)
	}
	<-shutdownComplete
}
