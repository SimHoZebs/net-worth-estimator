// Command server runs the net-worth-estimator backend.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
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

func parseAllowedOrigins(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}

	origins := make([]string, 0)
	seen := make(map[string]struct{})
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return nil, errors.New("origin entries cannot be empty")
		}
		parsed, err := url.Parse(candidate)
		if err != nil {
			return nil, fmt.Errorf("parse origin %q: %w", candidate, err)
		}
		scheme := strings.ToLower(parsed.Scheme)
		if (scheme != "http" && scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" {
			return nil, fmt.Errorf("origin %q must contain only an HTTP/S scheme and host", candidate)
		}
		if (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return nil, fmt.Errorf("origin %q cannot contain a path, query, or fragment", candidate)
		}

		host := strings.ToLower(parsed.Hostname())
		if host == "" {
			return nil, fmt.Errorf("origin %q must contain a host", candidate)
		}
		port := parsed.Port()
		if port != "" {
			parsedPort, err := strconv.Atoi(port)
			if err != nil || parsedPort < 1 || parsedPort > 65535 {
				return nil, fmt.Errorf("origin %q contains an invalid port", candidate)
			}
			port = strconv.Itoa(parsedPort)
		}
		if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
			port = ""
		}
		if port != "" {
			host = net.JoinHostPort(host, port)
		} else if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		origin := scheme + "://" + host
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins, nil
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
	allowedOrigins, err := parseAllowedOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))
	if err != nil {
		log.Fatalf("configure allowed origins: %v", err)
	}

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
		if _, _, err := database.ImportCSV(modelPath, incomePath); err != nil {
			log.Fatalf("seed from CSV: %v", err)
		}
		fmt.Printf("seeded database from %s and %s\n", modelPath, incomePath)
	}

	handler := api.New(database, api.Config{
		SeedModelPath:  modelPath,
		SeedIncomePath: incomePath,
		AllowedOrigins: allowedOrigins,
	})
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
