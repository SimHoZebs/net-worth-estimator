// Package obs provides structured logging and small HTTP observability
// middleware: JSON logs on stdout with request ids, status capture, and
// panic recovery. It has no application dependencies, so every layer can
// share the same helpers.
package obs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"
)

type requestIDKey struct{}

const headerResource = "Waypoint-Resource"

// Init installs a single-line JSON slog handler as the default logger on
// stdout. NET_WORTH_ESTIMATOR_LOG_LEVEL selects the minimum level: debug,
// info (default), warn, or error. Anything else keeps info.
func Init(getenv func(string) string) {
	level := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(getenv("NET_WORTH_ESTIMATOR_LOG_LEVEL"))) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	slog.SetDefault(slog.New(handler))
}

// RequestID returns the id assigned by the request logging middleware.
// Requests that bypass the middleware carry the empty string.
func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(requestIDKey{}).(string)
	return v
}

func newRequestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Entropy failure must not break a request; fall back to time.
		return fmt.Sprintf("t%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// statusWriter captures the response status code. It implements http.Flusher
// so Server-Sent Event streams keep working through the middleware, and
// Unwrap so http.ResponseController reaches the underlying writer.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status = code
		w.wrote = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status = http.StatusOK
		w.wrote = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
		return
	}
	if controller := http.NewResponseController(w.ResponseWriter); controller != nil {
		_ = controller.Flush()
	}
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func writerStarted(w http.ResponseWriter) bool {
	if sw, ok := w.(*statusWriter); ok {
		return sw.wrote
	}
	return false
}

// RequestLogger assigns a request id, then logs one line per request:
// method, path (no query string), status, duration in milliseconds, and the
// Waypoint-Resource response header when the identity boundary set one. It
// never logs subjects, credentials, cookies, or the query string.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := newRequestID()
		ctx := context.WithValue(r.Context(), requestIDKey{}, id)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r.WithContext(ctx))
		attrs := []any{
			"request_id", id,
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"dur_ms", time.Since(start).Milliseconds(),
		}
		if resource := sw.Header().Get(headerResource); resource != "" {
			attrs = append(attrs, "user_resource", resource)
		}
		level := slog.LevelInfo
		switch {
		case sw.status >= 500:
			level = slog.LevelError
		case sw.status >= 400:
			level = slog.LevelWarn
		}
		slog.Log(ctx, level, "http request", attrs...)
	})
}

// Recovery converts panics into a structured log line. If no bytes were
// written it also returns a 500 response. It runs outside the identity
// boundary so a panic there cannot escape as a dropped connection.
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			value := recover()
			if value == nil {
				return
			}
			slog.ErrorContext(r.Context(), "panic recovered",
				"request_id", RequestID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"panic", fmt.Sprint(value),
				"stack", string(debug.Stack()),
			)
			if !writerStarted(w) {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
