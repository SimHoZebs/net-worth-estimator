package integration

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
		`{"AccountId":"`+accountID+`","Balance":100,"observedAt":1769903999}`)
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
	if balance.Balance != 110 || balance.ObservedOn != "2026-01-31" || !balance.HasCheckpoint || balance.Archived {
		t.Fatalf("balance row = %+v, want 110 on 2026-01-31 (start-day rule in history), checked, active", balance)
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

func TestListTransactionsExcludesPurchaseMarkers(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	account := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"id":"cash","name":"Cash","kind":"cash","minBalance":0,"enabled":true}`)
	if account.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", account.Code, account.Body.String())
	}
	normal := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"id":"01900000-0000-7000-8000-000000000031","name":"Groceries","sourceAccountId":"cash","destinations":[],"amount":{"resolver":"expression","config":{"expression":"42.5"},"inputs":{}},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	if normal.Code != http.StatusOK {
		t.Fatalf("create posting status = %d, body %s", normal.Code, normal.Body.String())
	}
	marker := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"id":"01900000-0000-7000-8000-000000000032","name":"Laptop","sourceAccountId":"cash","amount":{"resolver":"expression","config":{"expression":"500"},"inputs":{}},"postedTime":1769904000,"transactionTime":1769904000,"enabled":true,"purchase":{"priority":0}}`)
	if marker.Code != http.StatusOK {
		t.Fatalf("create purchase posting status = %d, body %s", marker.Code, marker.Body.String())
	}

	for _, path := range []string{"/v1/transactions", "/v1/transactions?recurring=once"} {
		response := doRowRequest(t, handler, http.MethodGet, path, "")
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body %s", path, response.Code, response.Body.String())
		}
		var payload struct {
			Transactions []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"transactions"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
		if len(payload.Transactions) != 1 || payload.Transactions[0].ID != "01900000-0000-7000-8000-000000000031" {
			t.Fatalf("GET %s rows = %+v, want only the non-purchase posting", path, payload.Transactions)
		}
	}

	// The purchase row stays in the document: planned purchases remain
	// distinct from transactions instead of vanishing.
	model := doRowRequest(t, handler, http.MethodGet, "/v1/financial-model", "")
	if model.Code != http.StatusOK {
		t.Fatalf("model status = %d, body %s", model.Code, model.Body.String())
	}
	var read struct {
		Document types.FinancialModelDocument `json:"document"`
	}
	if err := json.Unmarshal(model.Body.Bytes(), &read); err != nil {
		t.Fatalf("decode model: %v", err)
	}
	if len(read.Document.Postings) != 2 {
		t.Fatalf("postings = %d, want 2", len(read.Document.Postings))
	}
	kept := false
	for _, posting := range read.Document.Postings {
		if posting.Purchase != nil && posting.ID == "01900000-0000-7000-8000-000000000032" {
			kept = true
		}
	}
	if !kept {
		t.Fatal("purchase marker missing from saved model")
	}

	// Reads keep working under read-only grants; only writes are blocked.
	readOnly := New(database, Config{ReadOnly: true})
	blocked := doRowRequest(t, readOnly, http.MethodGet, "/v1/transactions", "")
	if blocked.Code != http.StatusOK {
		t.Fatalf("read-only list status = %d, body %s", blocked.Code, blocked.Body.String())
	}
	var listed struct {
		Transactions []struct {
			ID string `json:"id"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(blocked.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode read-only list: %v", err)
	}
	if len(listed.Transactions) != 1 {
		t.Fatalf("read-only rows = %+v, want only the non-purchase posting", listed.Transactions)
	}
}

func ptr(s string) *string { return &s }

func TestAccountBalancesReportAdjustedSeparatelyFromObserved(t *testing.T) {
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

	// 09:00 observed 1000 by instant; an 11:00 manual actual of -100 follows.
	observed := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"AccountId":"`+accountID+`","Balance":1000,"observedAt":1773133200}`)
	if observed.Code != http.StatusOK {
		t.Fatalf("save checkpoint status = %d, body %s", observed.Code, observed.Body.String())
	}
	spent := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Spend","sourceAccountId":"`+accountID+`","destinations":[],"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"postedTime":1773140400,"transactionTime":1773140400,"enabled":true}`)
	if spent.Code != http.StatusOK {
		t.Fatalf("create posting status = %d, body %s", spent.Code, spent.Body.String())
	}

	response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
	if response.Code != http.StatusOK {
		t.Fatalf("GET balances status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Accounts []struct {
			Balance         float64  `json:"balance"`
			ObservedBalance *float64 `json:"observedBalance"`
			ObservedAt      *int64   `json:"observedAt"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	if len(payload.Accounts) != 1 {
		t.Fatalf("accounts = %d, want 1", len(payload.Accounts))
	}
	row := payload.Accounts[0]
	if row.Balance != 900 {
		t.Fatalf("adjusted balance = %v, want 900 (must not fold the latest checkpoint)", row.Balance)
	}
	if row.ObservedBalance == nil || *row.ObservedBalance != 1000 {
		t.Fatalf("observed balance = %+v, want 1000 separately", row.ObservedBalance)
	}
	if row.ObservedAt == nil || *row.ObservedAt != 1773133200 {
		t.Fatalf("observed timestamp = %+v, want the exact instant", row.ObservedAt)
	}
}

func TestAccountBalancesBlankUserStaysEmpty(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	for _, path := range []string{"/v1/accounts/balances", "/v1/accounts/balances?asOf=2026-03-10T10:00:00Z"} {
		response := doRowRequest(t, handler, http.MethodGet, path, "")
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body %s", path, response.Code, response.Body.String())
		}
		var payload struct {
			Accounts []struct{} `json:"accounts"`
			AsOf     string     `json:"asOf"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
		if payload.Accounts == nil || len(payload.Accounts) != 0 {
			t.Fatalf("blank user accounts = %+v, want empty", payload.Accounts)
		}
		if payload.AsOf == "" {
			t.Fatalf("blank user response missing asOf")
		}
	}
}

func TestExactCutPositionAndAccountListAgree(t *testing.T) {
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

	observed := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"AccountId":"`+accountID+`","Balance":1000,"observedAt":1773133200}`)
	if observed.Code != http.StatusOK {
		t.Fatalf("save checkpoint status = %d, body %s", observed.Code, observed.Body.String())
	}
	spent := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Spend","sourceAccountId":"`+accountID+`","destinations":[],"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"postedTime":1773140400,"transactionTime":1773140400,"enabled":true}`)
	if spent.Code != http.StatusOK {
		t.Fatalf("create posting status = %d, body %s", spent.Code, spent.Body.String())
	}

	cut := "2026-03-10T10:00:00Z"
	position := doRowRequest(t, handler, http.MethodPost, "/v1/position", `{"asOfDate":"`+cut+`"}`)
	if position.Code != http.StatusOK {
		t.Fatalf("position status = %d, body %s", position.Code, position.Body.String())
	}
	var positionPayload struct {
		Result *types.CurrentPosition `json:"result"`
	}
	if err := json.Unmarshal(position.Body.Bytes(), &positionPayload); err != nil {
		t.Fatalf("decode position: %v", err)
	}
	balances := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf="+cut, "")
	if balances.Code != http.StatusOK {
		t.Fatalf("balances status = %d, body %s", balances.Code, balances.Body.String())
	}
	var balancesPayload struct {
		Accounts []struct {
			Balance float64 `json:"balance"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(balances.Body.Bytes(), &balancesPayload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	if len(positionPayload.Result.Accounts) != 1 || len(balancesPayload.Accounts) != 1 {
		t.Fatalf("account counts = %d/%d, want 1/1", len(positionPayload.Result.Accounts), len(balancesPayload.Accounts))
	}
	if positionPayload.Result.Accounts[0].Balance != 1000 || balancesPayload.Accounts[0].Balance != 1000 {
		t.Fatalf("exact-cut position=%v list=%v, want 1000/1000 (11:00 actual excluded)",
			positionPayload.Result.Accounts[0].Balance, balancesPayload.Accounts[0].Balance)
	}
}

func TestAccountWithoutObservationNormalizesExactCutDay(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"Bare","kind":"cash","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", created.Code, created.Body.String())
	}
	// An RFC 3339 cut must not echo as a date-only value: calendar fields
	// normalize to the parsed cut day while the exact instant stays out of
	// the date fields (there is no observation to timestamp).
	response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10T10:00:00Z", "")
	if response.Code != http.StatusOK {
		t.Fatalf("balances status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		AsOf     string `json:"asOf"`
		Accounts []struct {
			Balance         float64  `json:"balance"`
			ObservedOn      string   `json:"observedOn"`
			HasCheckpoint   bool     `json:"hasCheckpoint"`
			ObservedBalance *float64 `json:"observedBalance"`
			ObservedAt      *int64   `json:"observedAt"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	if payload.AsOf != "2026-03-10" {
		t.Fatalf("asOf = %q, want normalized cut day 2026-03-10", payload.AsOf)
	}
	if len(payload.Accounts) != 1 {
		t.Fatalf("accounts = %d, want 1", len(payload.Accounts))
	}
	row := payload.Accounts[0]
	if row.ObservedOn != "2026-03-10" || row.HasCheckpoint || row.ObservedBalance != nil || row.ObservedAt != nil {
		t.Fatalf("unobserved row = %+v, want day-normalized empties", row)
	}
}

func TestAccountBalancesRejectsMalformedCut(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	// Malformed cuts are client input: 422, not 500.
	rejected := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=not-a-cut", "")
	if rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("malformed cut status = %d, want 422, body %s", rejected.Code, rejected.Body.String())
	}
	// Valid date and exact cuts still pass on the empty user.
	for _, cut := range []string{"2026-03-10", "2026-03-10T10:00:00Z"} {
		response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf="+cut, "")
		if response.Code != http.StatusOK {
			t.Fatalf("cut %s status = %d, want 200, body %s", cut, response.Code, response.Body.String())
		}
	}
	// Omitted cut still uses the documented default.
	defCut := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances", "")
	if defCut.Code != http.StatusOK {
		t.Fatalf("default cut status = %d, want 200, body %s", defCut.Code, defCut.Body.String())
	}
}

func TestAccountBalancesRejectsPreparationIssuesAsClientInput(t *testing.T) {
	database := openAPIStore(t)
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 1000, ObservedAt: 1773219600}); err != nil {
		t.Fatal(err)
	}
	response := doRowRequest(t, New(database, Config{}), http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("future observation status = %d, want 422, body %s", response.Code, response.Body.String())
	}
}

func TestAccountListArchivedDebtUsesExactObservation(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	kinds := []string{"cash", "debt"}
	ids := map[string]string{}
	for _, kind := range kinds {
		created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"`+kind+`","kind":"`+kind+`","enabled":true}`)
		if created.Code != http.StatusOK {
			t.Fatalf("create account status = %d, body %s", created.Code, created.Body.String())
		}
		var payload struct {
			Row struct {
				ID string `json:"id"`
			} `json:"row"`
		}
		if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode account: %v", err)
		}
		ids[kind] = payload.Row.ID
	}
	morning := int64(1773100800) + 9*3600
	evening := morning + 6*3600
	type observationSeed struct {
		date    string
		balance float64
		instant int64
	}
	// Same-day observations in both input orders must agree: the later
	// instant (nonzero) decides, not the row order.
	for _, order := range [][]observationSeed{
		{{"2026-03-10", 0.0, morning}, {"2026-03-10", -50.0, evening}},
		{{"2026-03-10", -50.0, evening}, {"2026-03-10", 0.0, morning}},
	} {
		for _, row := range order {
			saved := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
				`{"AccountId":"`+ids["debt"]+`","Balance":`+jsonNumber(row.balance)+`,"observedAt":`+jsonNumber(float64(row.instant))+`}`)
			if saved.Code != http.StatusOK {
				t.Fatalf("save checkpoint status = %d, body %s", saved.Code, saved.Body.String())
			}
		}
		balances := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
		if balances.Code != http.StatusOK {
			t.Fatalf("balances status = %d, body %s", balances.Code, balances.Body.String())
		}
		var payload struct {
			Accounts []struct {
				Archived        bool     `json:"archived"`
				ObservedBalance *float64 `json:"observedBalance"`
				ObservedOn      string   `json:"observedOn"`
			} `json:"accounts"`
		}
		if err := json.Unmarshal(balances.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode balances: %v", err)
		}
		var debt *struct {
			Archived        bool     `json:"archived"`
			ObservedBalance *float64 `json:"observedBalance"`
			ObservedOn      string   `json:"observedOn"`
		}
		for i := range payload.Accounts {
			if payload.Accounts[i].ObservedBalance != nil {
				debt = &payload.Accounts[i]
			}
		}
		if debt == nil || debt.ObservedBalance == nil || *debt.ObservedBalance != -50 {
			t.Fatalf("later same-day observation must win regardless of input order: %+v", payload.Accounts)
		}
		if debt.Archived {
			t.Fatalf("nonzero observed balance must not archive: %+v", debt)
		}
		if debt.ObservedOn != "2026-03-10" {
			t.Fatalf("observedOn = %s, want the observation day", debt.ObservedOn)
		}
		// Before the latest stored observation the earlier zero applies.
		early := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10T10:00:00Z", "")
		if early.Code != http.StatusOK {
			t.Fatalf("early balances status = %d, body %s", early.Code, early.Body.String())
		}
		var earlyPayload struct {
			Accounts []struct {
				Archived        bool     `json:"archived"`
				ObservedBalance *float64 `json:"observedBalance"`
			} `json:"accounts"`
		}
		if err := json.Unmarshal(early.Body.Bytes(), &earlyPayload); err != nil {
			t.Fatalf("decode early balances: %v", err)
		}
		for _, account := range earlyPayload.Accounts {
			if account.ObservedBalance != nil && *account.ObservedBalance == 0 && !account.Archived {
				t.Fatalf("zero observed balance at the cut must archive: %+v", account)
			}
		}
		// Reset the debt account's observations for the next input order.
		deleted := doRowRequest(t, handler, http.MethodDelete, "/v1/checkpoints?accountId="+ids["debt"]+"&observedAt="+jsonNumber(float64(morning)), "")
		if deleted.Code != http.StatusOK {
			t.Fatalf("delete checkpoints status = %d, body %s", deleted.Code, deleted.Body.String())
		}
		deleted = doRowRequest(t, handler, http.MethodDelete, "/v1/checkpoints?accountId="+ids["debt"]+"&observedAt="+jsonNumber(float64(evening)), "")
		if deleted.Code != http.StatusOK {
			t.Fatalf("delete checkpoints status = %d, body %s", deleted.Code, deleted.Body.String())
		}
	}
}

func jsonNumber(value float64) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
