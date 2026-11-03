package obs

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buffer := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(buffer, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return buffer
}

func logLines(t *testing.T, buffer *bytes.Buffer) []map[string]any {
	t.Helper()
	lines := []map[string]any{}
	for _, line := range strings.Split(strings.TrimRight(buffer.String(), "\n"), "\n") {
		if line == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("log line is not JSON: %v (%q)", err, line)
		}
		lines = append(lines, entry)
	}
	return lines
}

func TestRequestLoggerCapturesStatusAndKeepsFlusher(t *testing.T) {
	buffer := captureLogs(t)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := w.(http.Flusher); !ok {
			t.Error("Flusher lost through middleware")
		}
		if id := RequestID(r.Context()); id == "" {
			t.Error("request id missing from context")
		}
		w.Header().Set("Waypoint-Resource", "users/"+strings.Repeat("a", 64))
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("{}"))
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://example.test/v1/status?token=redact-me", nil)
	RequestLogger(next).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status=%d", recorder.Code)
	}
	lines := logLines(t, buffer)
	if len(lines) != 1 {
		t.Fatalf("lines=%d", len(lines))
	}
	line := lines[0]
	if line["msg"] != "http request" || line["status"] != float64(http.StatusCreated) {
		t.Fatalf("unexpected line: %v", line)
	}
	if line["path"] != "/v1/status" {
		t.Fatalf("path=%v", line["path"])
	}
	if strings.Contains(buffer.String(), "redact-me") {
		t.Fatal("query string leaked into logs")
	}
	if line["user_resource"] != "users/"+strings.Repeat("a", 64) {
		t.Fatalf("user_resource=%v", line["user_resource"])
	}
	if line["request_id"] == "" {
		t.Fatal("request_id missing")
	}
}

func TestRequestLoggerImplicit200WithoutWriteHeader(t *testing.T) {
	buffer := captureLogs(t)
	RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://example.test/x", nil))
	lines := logLines(t, buffer)
	if len(lines) != 1 || lines[0]["status"] != float64(http.StatusOK) {
		t.Fatalf("lines=%v", lines)
	}
}

func TestRecoveryLogsPanicAndWrites500(t *testing.T) {
	buffer := captureLogs(t)
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })
	recorder := httptest.NewRecorder()
	Recovery(next).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://example.test/v1/thing", nil))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d", recorder.Code)
	}
	lines := logLines(t, buffer)
	if len(lines) != 1 || lines[0]["msg"] != "panic recovered" {
		t.Fatalf("lines=%v", lines)
	}
	if lines[0]["panic"] != "boom" || lines[0]["stack"] == "" {
		t.Fatalf("missing panic payload: %v", lines[0])
	}
}

func TestRecoverySkipsWriteWhenResponseStarted(t *testing.T) {
	captureLogs(t)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		panic("after write")
	})
	recorder := httptest.NewRecorder()
	RequestLogger(Recovery(next)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://example.test/x", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d", recorder.Code)
	}
	if recorder.Body.String() != "partial" {
		t.Fatalf("body=%q", recorder.Body.String())
	}
}

type flushRecorder struct {
	http.ResponseWriter
	flushed bool
}

func (f *flushRecorder) Flush() { f.flushed = true }

func TestResponseControllerReachesUnderlyingWriter(t *testing.T) {
	underlying := &flushRecorder{ResponseWriter: httptest.NewRecorder()}
	sw := &statusWriter{ResponseWriter: underlying, status: http.StatusOK}
	if err := http.NewResponseController(sw).Flush(); err != nil {
		t.Fatalf("ResponseController flush: %v", err)
	}
	if !underlying.flushed {
		t.Fatal("flush did not reach the underlying writer")
	}
}
