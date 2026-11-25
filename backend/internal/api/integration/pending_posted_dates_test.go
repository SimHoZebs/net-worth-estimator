package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type pendingPostedDateRow struct {
	ID              string `json:"id"`
	StartDate       string `json:"startDate"`
	Enabled         bool   `json:"enabled"`
	Pending         bool   `json:"pending"`
	Void            bool   `json:"void"`
	PostedTime      int64  `json:"postedTime"`
	TransactionTime int64  `json:"transactionTime"`
}

func TestPendingToPostedPreservesDates(t *testing.T) {
	occurredAt := time.Date(2026, 3, 10, 8, 0, 0, 0, time.UTC).Unix()
	postedAt := time.Date(2026, 3, 11, 11, 0, 0, 0, time.UTC).Unix()

	database := openAPIStore(t)
	const accountID = "card"
	if _, err := database.CreateAccount(types.Account{
		ID: accountID, Name: "Card", Kind: types.AccountKindCreditCard, Enabled: true,
	}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	bridgeAccountID := simplefin.AccountKey("conn-test", "bank-card")
	if _, err := database.SaveAccountLink(store.AccountLink{
		BridgeAccountID: bridgeAccountID,
		ModelAccountID:  accountID,
		Origin:          store.LinkOriginManual,
	}); err != nil {
		t.Fatalf("link account: %v", err)
	}

	feed := func(transaction map[string]any) []byte {
		t.Helper()
		body, err := json.Marshal(map[string]any{
			"errlist":     []any{},
			"connections": []any{map[string]any{"conn_id": "conn-test", "name": "Test Bank"}},
			"accounts": []any{map[string]any{
				"id":           "bank-card",
				"conn_id":      "conn-test",
				"name":         "Card",
				"currency":     "USD",
				"balance":      "100",
				"balance-date": postedAt,
				"transactions": []any{transaction},
			}},
		})
		if err != nil {
			t.Fatalf("marshal feed: %v", err)
		}
		return body
	}
	feeds := [][]byte{
		feed(map[string]any{
			"id": "auth-1", "posted": 0, "transacted_at": occurredAt,
			"amount": "-42.10", "description": "Corner Store", "pending": true,
		}),
		feed(map[string]any{
			"id": "auth-1", "posted": postedAt,
			"amount": "-42.10", "description": "Corner Store", "pending": false,
		}),
	}
	var fetches atomic.Int64
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		index := int(fetches.Add(1)) - 1
		if index < 0 || index >= len(feeds) {
			http.Error(w, "unexpected feed request", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(feeds[index])
	}))
	t.Cleanup(bridge.Close)

	runner := simplefin.NewRunner(database, simplefin.Config{FetchMaxAttempts: 1}, &simplefin.Client{
		AccessURL: bridge.URL, HTTPClient: bridge.Client(),
	})
	handler := New(database, Config{})
	listTransactions := func() []pendingPostedDateRow {
		t.Helper()
		response := doRowRequest(t, handler, http.MethodGet, "/v1/transactions?accountId="+accountID, "")
		if response.Code != http.StatusOK {
			t.Fatalf("list status = %d, body %s", response.Code, response.Body.String())
		}
		var payload struct {
			Transactions []pendingPostedDateRow `json:"transactions"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode transactions: %v", err)
		}
		return payload.Transactions
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := runner.Sync(ctx); err != nil {
		t.Fatalf("apply pending feed: %v", err)
	}
	pendingRows := listTransactions()
	if len(pendingRows) != 1 {
		t.Fatalf("pending rows = %+v, want one authorization", pendingRows)
	}
	pendingRow := pendingRows[0]
	if _, err := uuid.Parse(pendingRow.ID); err != nil {
		t.Fatalf("pending ID = %q, want a UUID: %v", pendingRow.ID, err)
	}
	if !pendingRow.Pending || pendingRow.Void || pendingRow.StartDate != "2026-03-10" ||
		pendingRow.TransactionTime != occurredAt || pendingRow.PostedTime != 0 {
		t.Fatalf("pending row = %+v, want the original authorization instant", pendingRow)
	}

	if err := runner.Sync(ctx); err != nil {
		t.Fatalf("apply posted feed: %v", err)
	}
	settledRows := listTransactions()
	if len(settledRows) != 1 {
		t.Fatalf("settled rows = %+v, want one posted transaction", settledRows)
	}
	settledRow := settledRows[0]
	if settledRow.ID != pendingRow.ID || !settledRow.Enabled || settledRow.Pending || settledRow.Void ||
		settledRow.StartDate != "2026-03-10" || settledRow.TransactionTime != occurredAt ||
		settledRow.PostedTime != postedAt {
		t.Fatalf("settled row = %+v, want UUID %s with occurred day 2026-03-10 at %d and posted day 2026-03-11 at %d",
			settledRow, pendingRow.ID, occurredAt, postedAt)
	}
	if fetches.Load() != int64(len(feeds)) {
		t.Fatalf("bridge requests = %d, want %d", fetches.Load(), len(feeds))
	}
}
