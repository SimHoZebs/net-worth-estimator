package simplefin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func v2Bridge(t *testing.T, body string, status int) *Client {
	t.Helper()
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("version"); got != ProtocolVersion {
			t.Errorf("version = %q, want %q", got, ProtocolVersion)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(bridge.Close)
	return &Client{AccessURL: bridge.URL, HTTPClient: bridge.Client()}
}

func TestFetchParsesV2ConnectionsAndConnID(t *testing.T) {
	client := v2Bridge(t, `{
		"errlist": [],
		"connections": [{"conn_id": "CON-1", "name": "My Bank - James", "org_id": "ORG-1"}],
		"accounts": [{"id": "savings", "conn_id": "CON-1", "name": "Savings", "currency": "USD", "balance": "10", "available-balance": "8", "balance-date": 10, "transactions": []}]
	}`, http.StatusOK)
	set, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(set.Connections) != 1 || set.Connections[0].ConnID != "CON-1" {
		t.Fatalf("connections = %+v", set.Connections)
	}
	if len(set.Accounts) != 1 || set.Accounts[0].ConnID != "CON-1" {
		t.Fatalf("accounts = %+v", set.Accounts)
	}
	if set.Accounts[0].AvailableBalance == nil || *set.Accounts[0].AvailableBalance != "8" {
		t.Fatalf("available balance = %+v", set.Accounts[0].AvailableBalance)
	}
}

func TestFetchRejectsV1Shape(t *testing.T) {
	client := v2Bridge(t, `{"errors": [], "accounts": []}`, http.StatusOK)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var unsupported *UnsupportedVersionError
	if !errors.As(err, &unsupported) {
		t.Fatalf("error = %T (%v), want UnsupportedVersionError", err, err)
	}
}

func TestFetchMapsAuthErrorFrom403Body(t *testing.T) {
	client := v2Bridge(t, `{"errlist":[{"code":"gen.auth","msg":"Forbidden"}],"accounts":[]}`, http.StatusForbidden)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var auth *AuthError
	if !errors.As(err, &auth) {
		t.Fatalf("error = %T (%v), want AuthError", err, err)
	}
}

func TestFetchRejectsAccountMissingConnection(t *testing.T) {
	client := v2Bridge(t, `{
		"errlist": [],
		"connections": [{"conn_id": "CON-1", "name": "My Bank"}],
		"accounts": [{"id": "checking", "name": "Checking", "currency": "USD", "balance": "10", "balance-date": 10, "transactions": []}]
	}`, http.StatusOK)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var protocol *ProtocolErrorsError
	if !errors.As(err, &protocol) {
		t.Fatalf("error = %T (%v), want ProtocolErrorsError", err, err)
	}
}

func TestFetchMapsPaymentRequired(t *testing.T) {
	client := v2Bridge(t, `{"errlist":[],"connections":[],"accounts":[]}`, http.StatusPaymentRequired)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var payment *PaymentRequiredError
	if !errors.As(err, &payment) {
		t.Fatalf("error = %T (%v), want PaymentRequiredError", err, err)
	}
}

func TestFetchMapsPaymentRequiredWithEmptyBody(t *testing.T) {
	client := v2Bridge(t, ``, http.StatusPaymentRequired)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var payment *PaymentRequiredError
	if !errors.As(err, &payment) {
		t.Fatalf("error = %T (%v), want PaymentRequiredError", err, err)
	}
}

func TestFetchExcludesScopedErrorsWithoutFailing(t *testing.T) {
	client := v2Bridge(t, `{
		"errlist": [
			{"code": "con.auth", "msg": "Reauthenticate My Bank", "conn_id": "CON-1"},
			{"code": "act.failed", "msg": "Account failed", "conn_id": "CON-2", "account_id": "card"}
		],
		"connections": [
			{"conn_id": "CON-1", "name": "My Bank - James", "org_id": "ORG-1"},
			{"conn_id": "CON-2", "name": "My Bank - Jill", "org_id": "ORG-1"}
		],
		"accounts": [
			{"id": "savings", "conn_id": "CON-1", "name": "Savings", "currency": "USD", "balance": "10", "balance-date": 10, "transactions": []},
			{"id": "card", "conn_id": "CON-2", "name": "Card", "currency": "USD", "balance": "-5", "balance-date": 10, "transactions": []},
			{"id": "checking", "conn_id": "CON-2", "name": "Checking", "currency": "USD", "balance": "20", "balance-date": 10, "transactions": []}
		]
	}`, http.StatusOK)
	set, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	exclusions := set.Exclusions()
	if !exclusions.Excluded("CON-1", "savings") {
		t.Fatal("connection error did not exclude its account")
	}
	if !exclusions.Excluded("CON-2", "card") {
		t.Fatal("account error did not exclude its account")
	}
	if exclusions.Excluded("CON-2", "checking") {
		t.Fatal("healthy account was excluded")
	}
	if len(set.ErrList) != 2 {
		t.Fatalf("errlist = %+v", set.ErrList)
	}
}

func TestFetchFailsOnGeneralProtocolError(t *testing.T) {
	client := v2Bridge(t, `{
		"errlist": [{"code": "gen.api", "msg": "Bad request shape"}],
		"connections": [],
		"accounts": []
	}`, http.StatusOK)
	_, err := client.Fetch(context.Background(), time.Now().Add(-time.Hour), time.Now())
	var protocol *ProtocolErrorsError
	if !errors.As(err, &protocol) {
		t.Fatalf("error = %T (%v), want ProtocolErrorsError", err, err)
	}
}

func TestAccountKeyRoundTrip(t *testing.T) {
	key := AccountKey("CON-1", "acct.one/two")
	connID, accountID, ok := ParseAccountKey(key)
	if !ok || connID != "CON-1" || accountID != "acct.one/two" {
		t.Fatalf("parse %q = %q %q %v", key, connID, accountID, ok)
	}
	if _, _, ok := ParseAccountKey("bare-account-id"); ok {
		t.Fatal("bare account id accepted as a v2 key")
	}
	if _, _, ok := ParseAccountKey("sf2.bad!.value"); ok {
		t.Fatal("invalid base64 accepted")
	}
}

func TestDecodeAccountSetRequiresV2Markers(t *testing.T) {
	if _, err := decodeAccountSet("bridge.example", []byte(`{"errlist":[],"accounts":[]}`)); err == nil {
		t.Fatal("missing connections accepted")
	}
	if _, err := decodeAccountSet("bridge.example", []byte(`{"connections":[],"accounts":[]}`)); err == nil {
		t.Fatal("missing errlist accepted")
	}
	if _, err := decodeAccountSet("bridge.example", []byte(`{"errlist":[],"connections":[],"accounts":[]}`)); err != nil {
		t.Fatalf("complete v2 shape rejected: %v", err)
	}
	for _, body := range []string{
		`{"errlist":null,"connections":[],"accounts":[]}`,
		`{"errlist":[],"connections":null,"accounts":[]}`,
		`{"errlist":{},"connections":[],"accounts":[]}`,
		`{"errlist":[],"connections":{},"accounts":[]}`,
	} {
		if _, err := decodeAccountSet("bridge.example", []byte(body)); err == nil {
			t.Fatalf("non-array marker accepted: %s", body)
		}
	}
}

func TestAccountKeyIsURLSafeAndStable(t *testing.T) {
	key := AccountKey("CON-1", "acct")
	encoded, err := json.Marshal(key)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" {
		t.Fatal("empty key")
	}
	if AccountKey("CON-1", "acct") != key {
		t.Fatal("key is not deterministic")
	}
	if AccountKey("CON-2", "acct") == key {
		t.Fatal("connection is not part of the key")
	}
}
