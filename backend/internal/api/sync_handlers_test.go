package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const syncTriggerFixture = `{
  "accounts": [
    {
      "id": "bridge-checking",
      "name": "Checking",
      "currency": "USD",
      "balance": "1523.10",
      "balance-date": 1785628800,
      "transactions": []
    },
    {
      "id": "bridge-prime",
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

func TestSyncTriggerReadOnlyPolicy(t *testing.T) {
	for _, test := range []struct {
		name       string
		config     Config
		authHeader string
		want       int
	}{
		{name: "unconfigured runner", config: Config{}, want: http.StatusServiceUnavailable},
		{name: "read-only", config: Config{ReadOnly: true}, want: http.StatusForbidden},
		{name: "bearer cannot bypass read-only", config: Config{ReadOnly: true}, authHeader: "Bearer retired-token", want: http.StatusForbidden},
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
	for _, account := range []types.Account{{ID: "checking", Name: "Checking"}, {ID: "prime_card", Name: "Prime"}} {
		if _, err := database.CreateAccount(account); err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}
	for _, link := range [][2]string{{"bridge-checking", "checking"}, {"bridge-prime", "prime_card"}} {
		if _, err := database.SaveAccountLink(store.AccountLink{BridgeAccountID: link[0], ModelAccountID: link[1], Origin: store.LinkOriginManual}); err != nil {
			t.Fatalf("seed link: %v", err)
		}
	}
	runner := simplefin.NewRunner(database, simplefin.Config{
		AccessURL:    bridge.URL,
		CardAccounts: map[string]struct{}{"prime_card": {}},
		DryRun:       true,
	}, &simplefin.Client{AccessURL: bridge.URL})
	handler := New(database, Config{SyncRunner: runner})

	trigger := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/sync/simplefin", nil)
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
