package simplefin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchMaps429ToRateLimited(t *testing.T) {
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"errors":["Too many requests."]}`))
	}))
	t.Cleanup(bridge.Close)

	client := &Client{AccessURL: bridge.URL, HTTPClient: bridge.Client()}
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var rateLimited *RateLimitedError
	if !errors.As(err, &rateLimited) {
		t.Fatalf("fetch error = %T (%v), want RateLimitedError", err, err)
	}
	if rateLimited.RetryAfter != 120*time.Second {
		t.Fatalf("retry after = %v, want 120s", rateLimited.RetryAfter)
	}
}

func TestFetchDetectsRateLimitBodyOn200(t *testing.T) {
	for _, body := range []string{
		`{"errors":["Too many requests. SimpleFIN data is only refreshed once every 24 hours."],"accounts":[]}`,
		`{"errlist":[{"code":"gen.api","msg":"Too many requests, slow down"}],"accounts":[]}`,
	} {
		bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(body))
		}))
		client := &Client{AccessURL: bridge.URL, HTTPClient: bridge.Client()}
		_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
		var rateLimited *RateLimitedError
		if !errors.As(err, &rateLimited) {
			t.Fatalf("body %s: error = %T (%v), want RateLimitedError", body, err, err)
		}
		bridge.Close()
	}
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Now()
	header := http.Header{"Retry-After": []string{"30"}}
	if got := parseRetryAfter(header, now); got != 30*time.Second {
		t.Fatalf("seconds retry after = %v, want 30s", got)
	}
	future := now.Add(90 * time.Second).UTC().Format(http.TimeFormat)
	header.Set("Retry-After", future)
	if got := parseRetryAfter(header, now); got < 89*time.Second || got > 91*time.Second {
		t.Fatalf("date retry after = %v, want ~90s", got)
	}
	if got := parseRetryAfter(http.Header{}, now); got != 0 {
		t.Fatalf("missing retry after = %v, want 0", got)
	}
}
