package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
)

const syncTriggerFixture = `{
  "accounts": [
    {
      "id": "sfin-checking",
      "name": "Checking",
      "currency": "USD",
      "balance": "1523.10",
      "balance-date": 1785628800,
      "transactions": []
    },
    {
      "id": "sfin-prime",
      "name": "Prime Card",
      "currency": "USD",
      "balance": "-412.55",
      "balance-date": 1785628800,
      "transactions": [
        {"id": "pend1", "posted": 0, "amount": "-42.10", "description": "Corner Store", "pending": true}
      ]
    }
  ]
}`

func TestSyncTriggerRequiresAuth(t *testing.T) {
	for _, test := range []struct {
		name       string
		config     Config
		authHeader string
		want       int
	}{
		{name: "no token configured still serves when runner set", config: Config{}, authHeader: "", want: 503},
		{name: "token missing", config: Config{AuthToken: "tok"}, authHeader: "", want: http.StatusUnauthorized},
		{name: "token wrong", config: Config{AuthToken: "tok"}, authHeader: "Bearer nope", want: http.StatusUnauthorized},
		{name: "read-only wins over valid token", config: Config{ReadOnly: true, AuthToken: "tok"}, authHeader: "Bearer tok", want: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openAPIStore(t)
			handler := New(database, test.config)
			request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil)
			if test.authHeader != "" {
				request.Header.Set("Authorization", test.authHeader)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("trigger status = %d, want %d, body %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestSyncTriggerRunsDryRunAndGuardsInterval(t *testing.T) {
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(syncTriggerFixture))
	}))
	t.Cleanup(bridge.Close)

	database := openAPIStore(t)
	runner := simplefin.NewRunner(database, simplefin.Config{
		AccessURL:    bridge.URL,
		AccountMap:   map[string]string{"sfin-checking": "checking", "sfin-prime": "prime_card"},
		CardAccounts: map[string]struct{}{"prime_card": {}},
		DryRun:       true,
	}, &simplefin.Client{AccessURL: bridge.URL})
	handler := New(database, Config{AuthToken: "tok", SyncRunner: runner})

	trigger := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil)
		request.Header.Set("Authorization", "Bearer tok")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	first := trigger()
	if first.Code != http.StatusOK {
		t.Fatalf("first trigger status = %d, body %s", first.Code, first.Body.String())
	}
	var summary struct {
		CheckpointsInserted int            `json:"checkpointsInserted"`
		PendingInserted     int            `json:"pendingInserted"`
		Skipped             map[string]int `json:"skipped"`
		DryRun              bool           `json:"dryRun"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.CheckpointsInserted != 2 || summary.PendingInserted != 1 || !summary.DryRun {
		t.Fatalf("summary = %+v", summary)
	}

	second := trigger()
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second trigger status = %d, want 429, body %s", second.Code, second.Body.String())
	}
}
