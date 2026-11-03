package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func captureAPILogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buffer := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(buffer, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return buffer
}

func TestErrorBeaconLimiterWindow(t *testing.T) {
	limiter := &errorBeaconLimiter{}
	now := time.Unix(2_000_000, 0)
	for i := 0; i < beaconBurst; i++ {
		allowed, _ := limiter.allow(now)
		if !allowed {
			t.Fatalf("report %d of %d suppressed", i+1, beaconBurst)
		}
	}
	allowed, suppressed := limiter.allow(now)
	if allowed || suppressed != 1 {
		t.Fatalf("over-burst report allowed=%v suppressed=%d", allowed, suppressed)
	}
	_, suppressed = limiter.allow(now)
	if suppressed != 2 {
		t.Fatalf("suppressed=%d want=2", suppressed)
	}
	// The next window emits again.
	now = now.Add(2 * beaconWindow)
	allowed, suppressed = limiter.allow(now)
	if !allowed || suppressed != 0 {
		t.Fatalf("after window: allowed=%v suppressed=%d", allowed, suppressed)
	}
}

func TestClientErrorsHandlerSuppressesFloodButStillAnswers(t *testing.T) {
	buffer := captureAPILogs(t)
	previous := clientErrorLimiter
	clientErrorLimiter = &errorBeaconLimiter{}
	t.Cleanup(func() { clientErrorLimiter = previous })

	router := chi.NewRouter()
	registerClientErrors(router)

	report := `{"message":"boom","source":"error","path":"/ledger"}`
	var wg sync.WaitGroup
	codes := make([]int, beaconBurst+5)
	for i := range codes {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "http://example.test/v1/client-errors", strings.NewReader(report))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			codes[index] = w.Code
		}(i)
	}
	wg.Wait()
	for _, code := range codes {
		if code != http.StatusNoContent {
			t.Fatalf("code=%d, every flooding report must still answer 204", code)
		}
	}
	var errorLines, suppressedLines int
	for _, line := range strings.Split(strings.TrimRight(buffer.String(), "\n"), "\n") {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("not JSON: %q", line)
		}
		switch entry["msg"] {
		case "browser error":
			errorLines++
		case "browser error reports suppressed":
			suppressedLines++
		}
	}
	if errorLines != beaconBurst {
		t.Fatalf("browser error lines=%d want=%d", errorLines, beaconBurst)
	}
	if suppressedLines != 1 {
		t.Fatalf("suppressed summary lines=%d want=1", suppressedLines)
	}
}
