package simplefin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"
)

func rangeNoticeBody(t *testing.T, entries []ProtocolError) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"errlist":     entries,
		"connections": []map[string]any{{"conn_id": "CON-1"}},
		"accounts": []map[string]any{{
			"id": "checking", "conn_id": "CON-1", "name": "Private account", "currency": "USD",
			"balance": "1234.56", "balance-date": 1793984400,
			"transactions": []map[string]any{{
				"id": "private-transaction", "posted": 1793980800, "amount": "-25.00", "description": "Private merchant",
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestSyncAppliesDataWithRangeNotices(t *testing.T) {
	for _, message := range []string{
		"Requested date range exceeds limit of 90 days and was capped.",
		"Requested date range exceeds recommended range of 45 days. In the future, this may be capped.",
	} {
		t.Run(message, func(t *testing.T) {
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })
			client := v2Bridge(t, rangeNoticeBody(t, []ProtocolError{{Code: "gen.api", Msg: message}}), http.StatusOK)
			database := openRunnerStore(t)
			runner := NewRunner(database, Config{}, client)
			summary, err := runner.Sync(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if summary.AccountsProvisioned != 1 || summary.CheckpointsInserted != 1 || summary.SettledInserted != 1 {
				t.Fatalf("summary = %+v", summary)
			}
			rows, err := database.LoadBankTransactions()
			if err != nil || len(rows) != 1 {
				t.Fatalf("stored transactions = %v, err %v", len(rows), err)
			}
			notice, err := database.GetSyncError()
			if err != nil || notice == nil || notice.Message != message || !summary.Partial || len(summary.Errors) != 1 {
				t.Fatalf("notice = %+v, summary = %+v, err %v", notice, summary, err)
			}
			if last, err := database.GetLastSyncTime(); err != nil || last == "" {
				t.Fatalf("successful sync timestamp = %q, err %v", last, err)
			}
			for _, want := range []string{`"msg":"simplefin response"`, `"accounts":1`, `"transactions":1`, `"notices":1`, `"msg":"simplefin sync applied"`, `"settled_inserted":1`} {
				if !strings.Contains(logs.String(), want) {
					t.Errorf("missing log field %s: %s", want, logs.String())
				}
			}
			for _, secret := range []string{"Private account", "Private merchant", "private-transaction", "1234.56", client.AccessURL} {
				if strings.Contains(logs.String(), secret) {
					t.Errorf("sensitive value logged: %q", secret)
				}
			}
		})
	}
}

func TestAccountExtraKeysLoggedWithoutValues(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	body, err := json.Marshal(map[string]any{
		"errlist":     []any{},
		"connections": []map[string]any{{"conn_id": "CON-1"}},
		"accounts": []map[string]any{
			{"id": "checking", "conn_id": "CON-1", "name": "Private account", "currency": "USD", "balance": "1234.56", "balance-date": 1793984400, "transactions": []map[string]any{}},
			{"id": "card", "conn_id": "CON-1", "name": "Private card", "currency": "USD", "balance": "-987.65", "balance-date": 1793984400, "extra": map[string]string{"type": "credit_card-secret-value", "account_id": "private-account-id"}, "transactions": []map[string]any{}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	client := v2Bridge(t, string(body), http.StatusOK)
	set, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(set.Accounts[1].Extra) != 2 {
		t.Fatalf("account extra not preserved: %+v", set.Accounts[1].Extra)
	}
	for _, want := range []string{`"accounts_with_extra":1`, `"account_id"`, `"type"`} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("missing probe field %s: %s", want, logs.String())
		}
	}
	for _, secret := range []string{"credit_card-secret-value", "private-account-id", "Private account", "Private card", "1234.56", "-987.65", client.AccessURL} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("sensitive value logged: %q", secret)
		}
	}
}

func TestRangeNoticeDoesNotHideOtherGeneralErrors(t *testing.T) {
	client := v2Bridge(t, rangeNoticeBody(t, []ProtocolError{
		{Code: "gen.api", Msg: "Requested date range exceeds limit of 90 days and was capped."},
		{Code: "gen.api", Msg: "Bad request shape"},
	}), http.StatusOK)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var protocol *ProtocolErrorsError
	if !errors.As(err, &protocol) || len(protocol.Errors) != 1 || protocol.Errors[0].Msg != "Bad request shape" {
		t.Fatalf("error = %v, want remaining general error", err)
	}
}

func TestRangeNoticeDoesNotHideScopedSyncFailure(t *testing.T) {
	for _, scope := range []struct {
		code      string
		accountID string
		wantScope string
	}{
		{code: "con.auth", wantScope: "connection"},
		{code: "act.failed", accountID: "checking", wantScope: "account"},
	} {
		t.Run(scope.code, func(t *testing.T) {
			client := v2Bridge(t, rangeNoticeBody(t, []ProtocolError{
				{Code: "gen.api", Msg: "Requested date range exceeds limit of 90 days and was capped."},
				{Code: scope.code, Msg: "Bank needs attention", ConnID: "CON-1", AccountID: scope.accountID},
			}), http.StatusOK)
			database := openRunnerStore(t)
			runner := NewRunner(database, Config{}, client)
			summary, err := runner.Sync(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if summary.AccountsProvisioned != 0 || summary.CheckpointsInserted != 0 || summary.SettledInserted != 0 || len(summary.Errors) != 2 {
				t.Fatalf("affected account was applied or notices lost: %+v", summary)
			}
			rows, err := database.LoadBankTransactions()
			if err != nil || len(rows) != 0 {
				t.Fatalf("stored excluded transactions = %v, err %v", len(rows), err)
			}
			notice, err := database.GetSyncError()
			if err != nil || notice == nil || notice.Code != scope.code || notice.Scope != scope.wantScope {
				t.Fatalf("displayed notice = %+v, err %v", notice, err)
			}
		})
	}
}
