package main

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/ingress"
)

// deploymentHandler owns the public ingress and infrastructure probes. Identity
// and API handlers receive the same request shape on every hosting provider.
func deploymentHandler(next http.Handler, database *sql.DB, config identity.Config, secret string) (http.Handler, error) {
	origins, err := config.ProxyOrigins()
	if err != nil {
		return nil, err
	}
	wrap, err := ingress.New(secret, origins)
	if err != nil {
		return nil, err
	}
	application := wrap(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && r.URL.Path != "/readyz" {
			application.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/readyz" {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := database.PingContext(ctx); err != nil {
				http.Error(w, "not ready", http.StatusServiceUnavailable)
				return
			}
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte("ok"))
		}
	}), nil
}
