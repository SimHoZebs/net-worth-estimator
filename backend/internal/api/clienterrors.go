package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/simhozebs/net-worth-estimator/backend/internal/obs"
)

const clientErrorMaxBytes = 16 << 10

// Browser error reports flood easily; anyone with curl can post them. Allow
// a burst per fixed window, then count the rest and log one summary line so
// the retained container logs cannot be buried by a headerless loop.
const beaconBurst = 30
const beaconWindow = time.Minute

type errorBeaconLimiter struct {
	windowStart atomic.Int64
	count       atomic.Int64
	suppressed  atomic.Int64
}

// allow reports both whether to emit and how many reports this window
// dropped. Callers pass the time so tests can drive the window forward.
func (limiter *errorBeaconLimiter) allow(now time.Time) (bool, int64) {
	windowStart := limiter.windowStart.Load()
	if now.Unix()-windowStart >= int64(beaconWindow/time.Second) {
		// Losing the race to reset is fine: one window gets one reset.
		if limiter.windowStart.CompareAndSwap(windowStart, now.Unix()) {
			limiter.count.Store(0)
			limiter.suppressed.Store(0)
		}
	}
	if limiter.count.Add(1) <= beaconBurst {
		return true, limiter.suppressed.Load()
	}
	return false, limiter.suppressed.Add(1)
}

var clientErrorLimiter = &errorBeaconLimiter{}

// clientErrorReport is the browser's unhandled-error beacon payload.
// Stack traces stay bounded so a runaway page cannot flood the log.
type clientErrorReport struct {
	Message string `json:"message"`
	Stack   string `json:"stack,omitempty"`
	Source  string `json:"source,omitempty"`
	Path    string `json:"path,omitempty"`
}

// registerClientErrors logs one structured line per accepted browser error
// report. It accepts both window.onerror and unhandledrejection beacons. The
// request_id joins the line to this beacon's own request log line; the
// report itself carries no Waypoint-Resource, so no user scope is attached.
// Over-burst reports return 204 like any other, but emit no log line.
func registerClientErrors(router chi.Router) {
	router.Post("/v1/client-errors", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, clientErrorMaxBytes)
		var report clientErrorReport
		if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
			http.Error(w, "invalid client error report", http.StatusBadRequest)
			return
		}
		report.Message = strings.TrimSpace(report.Message)
		if report.Message == "" || len(report.Message) > 1024 {
			http.Error(w, "invalid client error report", http.StatusBadRequest)
			return
		}
		if len(report.Stack) > 8192 {
			report.Stack = report.Stack[:8192]
		}
		if len(report.Path) > 512 {
			report.Path = report.Path[:512]
		}
		if report.Source != "error" && report.Source != "unhandledrejection" {
			report.Source = "unknown"
		}
		emit, suppressed := clientErrorLimiter.allow(time.Now())
		if !emit {
			if suppressed == 1 {
				slog.WarnContext(r.Context(), "browser error reports suppressed",
					"request_id", obs.RequestID(r.Context()),
					"burst", beaconBurst,
					"window_seconds", int64(beaconWindow/time.Second))
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		attrs := []any{
			"component", "frontend",
			"source", report.Source,
			"message", report.Message,
			"path", report.Path,
			"request_id", obs.RequestID(r.Context()),
		}
		if suppressed > 0 {
			attrs = append(attrs, "suppressed_before", suppressed)
		}
		if report.Stack != "" {
			attrs = append(attrs, "stack", report.Stack)
		}
		slog.ErrorContext(r.Context(), "browser error", attrs...)
		w.WriteHeader(http.StatusNoContent)
	})
}
