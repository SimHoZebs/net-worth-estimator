// Command server runs the net-worth-estimator backend.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/obs"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// bootFatalf logs one structured line and exits non-zero. Boot failures exit
// before serving; request-path errors never use this.
func bootFatalf(message string, err error) {
	slog.Error(message, "error", err)
	os.Exit(1)
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
	obs.Init(os.Getenv)
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	host := envOr("HOST", "127.0.0.1")
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", defaultDBPath())
	allowedOrigins, err := parseAllowedOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))
	if err != nil {
		bootFatalf("configure allowed origins", err)
	}
	readOnly := parseReadOnly(os.Getenv("NET_WORTH_ESTIMATOR_READ_ONLY"))
	receiptSource, err := configureReceiptSource(os.Getenv("NET_WORTH_ESTIMATOR_RECEIPT_SOURCE"))
	if err != nil {
		bootFatalf("configure receipt extraction", err)
	}
	identityConfig, err := identity.FromEnv(os.Getenv)
	if err != nil {
		bootFatalf("configure identity", err)
	}
	database, err := sqlite.OpenDatabase(dbPath)
	if err != nil {
		bootFatalf("open store", err)
	}
	defer database.Close()
	stopBlobCleanup := database.StartBlobCleanup(context.Background(), func(err error) { slog.Error("blob cleanup", "error", err) })
	defer stopBlobCleanup()
	analysisRunner, err := analysis.NewRunner(database, analysis.Definitions()...)
	if err != nil {
		bootFatalf("configure analyses", err)
	}
	stopAnalyses := analysisRunner.Start(context.Background(), 15*time.Second, func(error) { slog.Warn("background analysis temporarily unavailable") })
	defer stopAnalyses()
	categoryWorker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		bootFatalf("configure categorization", err)
	}
	stopCategories := categoryWorker.Start(context.Background(), 15*time.Second, func(error) { slog.Warn("background categorization temporarily unavailable") })
	defer stopCategories()

	resources, err := resourceConfigFromEnv(os.Getenv)
	if err != nil {
		bootFatalf("configure user resources", err)
	}
	syncStore, err := ownerSyncStore(database, identityConfig.Issuer, resources.OwnerSubject)
	if err != nil {
		bootFatalf("configure SimpleFIN user", err)
	}
	syncRunner, syncStop := configureSync(syncStore)
	defer syncStop()

	apiConfig := api.Config{
		ReceiptSource:        receiptSource,
		AllowedOrigins:       allowedOrigins,
		ReadOnly:             readOnly,
		SyncRunner:           syncRunner,
		GmailService:         configureGmail(),
		GmailFrontendBaseURL: strings.TrimRight(os.Getenv("NET_WORTH_ESTIMATOR_PUBLIC_URL"), "/"),
	}
	handler, closeResources, err := resourceHandler(context.Background(), database, resources, identityConfig, apiConfig)
	if err != nil {
		bootFatalf("configure resource access", err)
	}
	defer closeResources()
	handler, err = deploymentHandler(handler, database, identityConfig, os.Getenv("NET_WORTH_ESTIMATOR_PROXY_SECRET"))
	if err != nil {
		bootFatalf("configure deployment ingress", err)
	}
	handler = obs.Recovery(handler)
	handler = obs.RequestLogger(handler)
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
			slog.Error("graceful shutdown", "error", err)
		}
		close(shutdownComplete)
	}()

	slog.Info("server listening", "addr", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		bootFatalf("server", err)
	}
	<-shutdownComplete
}
