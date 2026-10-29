package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func decodeQueryBody(t *testing.T, response map[string]json.RawMessage, key string) []json.RawMessage {
	t.Helper()
	var items []json.RawMessage
	if err := json.Unmarshal(response[key], &items); err != nil {
		t.Fatalf("decode %s: %v", key, err)
	}
	return items
}

func TestNarrowQueriesRoundTrip(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", created.Code, created.Body.String())
	}
	var accountPayload struct {
		Row struct {
			ID string `json:"id"`
		} `json:"row"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &accountPayload); err != nil {
		t.Fatalf("decode account: %v", err)
	}
	accountID := accountPayload.Row.ID

	posting := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Pay","sourceAccountId":null,"destinations":["`+accountID+`"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	if posting.Code != http.StatusOK {
		t.Fatalf("create posting status = %d, body %s", posting.Code, posting.Body.String())
	}
	rule := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"name":"Salary","sourceAccountId":null,"destinations":["`+accountID+`"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"frequency":"monthly","startDate":"2026-02-01","enabled":true,"priority":1}`)
	if rule.Code != http.StatusOK {
		t.Fatalf("create rule status = %d, body %s", rule.Code, rule.Body.String())
	}
	checkpoint := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"Date":"2026-01-31","AccountId":"`+accountID+`","Balance":100}`)
	if checkpoint.Code != http.StatusOK {
		t.Fatalf("save checkpoint status = %d, body %s", checkpoint.Code, checkpoint.Body.String())
	}
	evaluation := doRowRequest(t, handler, http.MethodPost, "/v1/evaluations",
		`{"type":"netWorthThreshold","name":"Reach target","enabled":true,"config":{"target":500}}`)
	if evaluation.Code != http.StatusOK {
		t.Fatalf("create evaluation status = %d, body %s", evaluation.Code, evaluation.Body.String())
	}

	get := func(path string) map[string]json.RawMessage {
		t.Helper()
		response := doRowRequest(t, handler, http.MethodGet, path, "")
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body %s", path, response.Code, response.Body.String())
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
		var revision string
		if err := json.Unmarshal(payload["revision"], &revision); err != nil || revision == "" {
			t.Fatalf("GET %s missing revision: %s", path, response.Body.String())
		}
		return payload
	}

	balances := get("/v1/accounts/balances?asOf=2026-02-01")
	balanceRows := decodeQueryBody(t, balances, "accounts")
	if len(balanceRows) != 1 {
		t.Fatalf("balances rows = %d, want 1", len(balanceRows))
	}
	var balance struct {
		Balance       float64 `json:"balance"`
		ObservedOn    string  `json:"observedOn"`
		HasCheckpoint bool    `json:"hasCheckpoint"`
		Archived      bool    `json:"archived"`
	}
	if err := json.Unmarshal(balanceRows[0], &balance); err != nil {
		t.Fatalf("decode balance row: %v", err)
	}
	if balance.Balance != 100 || balance.ObservedOn != "2026-01-31" || !balance.HasCheckpoint || balance.Archived {
		t.Fatalf("balance row = %+v, want 100 on 2026-01-31, checked, active", balance)
	}

	transactions := get("/v1/transactions?accountId=" + accountID)
	if len(decodeQueryBody(t, transactions, "transactions")) != 2 {
		t.Fatalf("transactions for account = %s, want 2 rows", transactions["transactions"])
	}
	once := get("/v1/transactions?recurring=once")
	if len(decodeQueryBody(t, once, "transactions")) != 1 {
		t.Fatalf("once transactions = %s, want 1 row", once["transactions"])
	}

	catalog := get("/v1/transactions/catalog")
	if len(decodeQueryBody(t, catalog, "items")) != 2 {
		t.Fatalf("catalog items = %s, want 2", catalog["items"])
	}

	summary := get("/v1/evaluations/summary")
	var tables struct {
		NetWorthThreshold []struct {
			InstanceID string `json:"instanceId"`
		} `json:"netWorthThreshold"`
	}
	if err := json.Unmarshal(summary["evaluations"], &tables); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if len(tables.NetWorthThreshold) != 1 {
		t.Fatalf("threshold rows = %d, want 1", len(tables.NetWorthThreshold))
	}

	filtered := get("/v1/checkpoints?accountId=" + accountID + "&since=2026-01-01&until=2026-12-31")
	if len(decodeQueryBody(t, filtered, "checkpoints")) != 1 {
		t.Fatalf("checkpoints = %s, want 1", filtered["checkpoints"])
	}
	empty := get("/v1/checkpoints?accountId=" + accountID + "&since=2027-01-01")
	if len(decodeQueryBody(t, empty, "checkpoints")) != 0 {
		t.Fatalf("future checkpoints = %s, want 0", empty["checkpoints"])
	}

	for _, key := range []string{"accounts", "transactions", "items", "evaluations", "checkpoints"} {
		_ = key
	}
	revisions := map[string]string{}
	for _, path := range []string{
		"/v1/accounts/balances?asOf=2026-02-01",
		"/v1/transactions?accountId=" + accountID,
		"/v1/transactions/catalog",
		"/v1/evaluations/summary",
		"/v1/checkpoints?accountId=" + accountID,
	} {
		var revision string
		if err := json.Unmarshal(get(path)["revision"], &revision); err != nil {
			t.Fatalf("revision %s: %v", path, err)
		}
		revisions[path] = revision
	}
	for path, revision := range revisions {
		if revision != revisions["/v1/accounts/balances?asOf=2026-02-01"] {
			t.Fatalf("revision skew: %s = %s", path, revision)
		}
	}
}

func TestListTransactionsReportsVoid(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"card","name":"Card","kind":"cash","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("seed account status = %d, body %s", created.Code, created.Body.String())
	}
	owner := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Settled","destinations":["card"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	if owner.Code != http.StatusOK {
		t.Fatalf("create posting status = %d, body %s", owner.Code, owner.Body.String())
	}
	bank := types.Posting{
		Name: "Vanished auth", Source: store.SourceSimpleFIN, SourceAccountID: ptr("card"),
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "42.10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785628800,
		TransactionTime: 1785628800,
		Enabled:         false,
		Pending:         true,
	}
	if _, err := database.ApplySyncPlan(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{Posting: bank, Keys: []store.BankKey{{Provider: store.SourceSimpleFIN, AccountID: "bridge-card", TransactionID: "auth1"}}},
	}}); err != nil {
		t.Fatalf("bank upsert: %v", err)
	}
	document, err := database.LoadDocument()
	if err != nil || len(document.Postings) != 2 {
		t.Fatalf("postings = %+v, err %v", document.Postings, err)
	}
	var bankID string
	for _, posting := range document.Postings {
		if posting.Source == store.SourceSimpleFIN {
			bankID = posting.ID
		}
	}
	if bankID == "" {
		t.Fatalf("bank posting missing in %+v", document.Postings)
	}
	if _, err := database.ApplySyncPlan(nil, []store.BankDirective{{Void: bankID}}); err != nil {
		t.Fatalf("bank void: %v", err)
	}
	response := doRowRequest(t, handler, http.MethodGet, "/v1/transactions", "")
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Transactions []struct {
			ID   string `json:"id"`
			Void bool   `json:"void"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	seen := map[string]bool{}
	for _, row := range payload.Transactions {
		seen[row.ID] = row.Void
	}
	if len(seen) != 2 {
		t.Fatalf("rows = %+v, want both postings", payload.Transactions)
	}
	if !seen[bankID] {
		t.Fatalf("bank row void = false, want the sync void flag reported")
	}
	for _, posting := range document.Postings {
		if posting.Source != store.SourceSimpleFIN && seen[posting.ID] {
			t.Fatalf("owner row %s void = true, want false", posting.ID)
		}
	}
}

func ptr(s string) *string { return &s }
