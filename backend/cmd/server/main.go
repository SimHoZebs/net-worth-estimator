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
	"syscall"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
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

func main() {
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	host := envOr("HOST", "127.0.0.1")
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", defaultDBPath())
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Fatalf("create database directory %s: %v", dir, err)
		}
	}
	modelPath := envOr("NET_WORTH_ESTIMATOR_MODEL_PATH", "public/configs")
	incomePath := envOr("NET_WORTH_ESTIMATOR_INCOME_PATH", "public/data/income")

	database, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer database.Close()

	exists, err := database.DocumentExists()
	if err != nil {
		log.Fatalf("check store: %v", err)
	}
	if !exists {
		if err := database.ImportCSV(modelPath, incomePath); err != nil {
			log.Fatalf("seed from CSV: %v", err)
		}
		fmt.Printf("seeded database from %s and %s\n", modelPath, incomePath)
	}

	handler := api.New(database, modelPath, incomePath)
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
