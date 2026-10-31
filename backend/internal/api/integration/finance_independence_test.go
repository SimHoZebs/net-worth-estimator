package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Finance-first lifecycle over HTTP: a persisted invalid forecast
// evaluation (seeded through the low-level store, modeling invalid
// config no public endpoint would accept) cannot block current-position,
// balance, or transaction reads, nor unrelated finance writes. The
// deterministic projection still reports the evaluation error, and
// deleting an account a configured evaluation references still rejects
// without changing data or revision.

func financeIndependenceIDs(t *testing.T, responseBody []byte) string {
	t.Helper()
	var payload struct {
		Row struct {
			ID string `json:"id"`
		} `json:"row"`
		Persisted bool `json:"persisted"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		t.Fatalf("decode row id: %v", err)
	}
	if !payload.Persisted || payload.Row.ID == "" {
		t.Fatalf("row not persisted: %s", responseBody)
	}
	return payload.Row.ID
}

func financeHasIssueCode(body []byte, code string) bool {
	var payload struct {
		Issues []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}
	for _, issue := range payload.Issues {
		if issue.Severity == types.SeverityError && issue.Code == code {
			return true
		}
	}
	return false
}

func TestFinanceIndependentOfInvalidForecastEvaluation(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	checkingID := financeIndependenceIDs(t, doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Checking","kind":"cash","enabled":true}`).Body.Bytes())
	savingsID := financeIndependenceIDs(t, doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Savings","kind":"cash","enabled":true}`).Body.Bytes())

	if response := doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"AccountId":"`+checkingID+`","Balance":1000,"observedAt":1773133200}`); response.Code != http.StatusOK {
		t.Fatalf("save checkpoint status = %d, body %s", response.Code, response.Body.String())
	}
	postingID := financeIndependenceIDs(t, doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Spend","sourceAccountId":"`+checkingID+`","destinations":[],"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"postedTime":1773140400,"transactionTime":1773140400,"enabled":true}`).Body.Bytes())
	ruleID := financeIndependenceIDs(t, doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"name":"Salary","sourceAccountId":null,"destinations":["`+checkingID+`"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"frequency":"monthly","startDate":"2026-02-01","enabled":true,"priority":1}`).Body.Bytes())

	// A configured evaluation referencing savings stays valid through the
	// public endpoint while the model is otherwise clean.
	if response := doRowRequest(t, handler, http.MethodPost, "/v1/evaluations",
		`{"type":"accountBalance","name":"Watch savings","enabled":true,"config":{"accountId":"`+savingsID+`","target":100}}`); response.Code != http.StatusOK {
		t.Fatalf("create evaluation status = %d, body %s", response.Code, response.Body.String())
	}

	// Seed persisted invalid forecast state the public API would reject:
	// a broken config shape and a dangling account reference.
	if _, err := database.CreateEvaluation(store.EvaluationUpdate{
		Type: "netWorthThreshold", Name: "Broken", Enabled: true,
		Config: map[string]any{"target": "not-a-number"},
	}); err != nil {
		t.Fatalf("seed broken evaluation: %v", err)
	}
	if _, err := database.CreateEvaluation(store.EvaluationUpdate{
		Type: "accountBalance", Name: "Ghost", Enabled: true,
		Config: map[string]any{"accountId": "ghost", "target": 50.0},
	}); err != nil {
		t.Fatalf("seed dangling evaluation: %v", err)
	}

	// Reads stay independent of the invalid forecast.
	balances := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
	if balances.Code != http.StatusOK {
		t.Fatalf("balances status = %d, body %s", balances.Code, balances.Body.String())
	}
	var balancePayload struct {
		Accounts []struct {
			ID      string  `json:"id"`
			Balance float64 `json:"balance"`
		} `json:"accounts"`
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(balances.Body.Bytes(), &balancePayload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	if len(balancePayload.Accounts) != 2 || balancePayload.Revision == "" {
		t.Fatalf("balances = %+v", balancePayload)
	}
	revisionBefore := balancePayload.Revision

	transactions := doRowRequest(t, handler, http.MethodGet, "/v1/transactions", "")
	if transactions.Code != http.StatusOK {
		t.Fatalf("transactions status = %d, body %s", transactions.Code, transactions.Body.String())
	}
	var transactionPayload struct {
		Transactions []struct {
			ID string `json:"id"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(transactions.Body.Bytes(), &transactionPayload); err != nil {
		t.Fatalf("decode transactions: %v", err)
	}
	if len(transactionPayload.Transactions) != 2 {
		t.Fatalf("transactions = %+v, want posting plus rule", transactionPayload.Transactions)
	}

	position := doRowRequest(t, handler, http.MethodPost, "/v1/position", `{"asOfDate":"2026-03-10"}`)
	if position.Code != http.StatusOK {
		t.Fatalf("position status = %d, body %s", position.Code, position.Body.String())
	}
	var positionPayload struct {
		Result *types.CurrentPosition `json:"result"`
	}
	if err := json.Unmarshal(position.Body.Bytes(), &positionPayload); err != nil {
		t.Fatalf("decode position: %v", err)
	}
	if positionPayload.Result == nil || len(positionPayload.Result.Accounts) != 2 {
		t.Fatalf("position = %+v, want two accounts", positionPayload.Result)
	}

	// Unrelated finance writes persist despite the invalid forecast.
	patches := []struct{ method, path, body string }{
		{http.MethodPatch, "/v1/accounts/" + checkingID,
			`{"name":"Checking renamed","kind":"cash","enabled":true}`},
		{http.MethodPatch, "/v1/postings/" + postingID,
			`{"name":"Spend edited","sourceAccountId":"` + checkingID + `","destinations":[],"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"postedTime":1773140400,"transactionTime":1773140400,"enabled":true}`},
		{http.MethodPatch, "/v1/recurrence-rules/" + ruleID,
			`{"name":"Salary edited","sourceAccountId":null,"destinations":["` + checkingID + `"],"amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"frequency":"monthly","startDate":"2026-02-01","enabled":true}`},
	}
	for _, patch := range patches {
		response := doRowRequest(t, handler, patch.method, patch.path, patch.body)
		if response.Code != http.StatusOK {
			t.Fatalf("%s %s status = %d, body %s", patch.method, patch.path, response.Code, response.Body.String())
		}
		var persisted struct {
			Persisted bool `json:"persisted"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &persisted); err != nil || !persisted.Persisted {
			t.Fatalf("%s %s must persist: %s", patch.method, patch.path, response.Body.String())
		}
	}

	// The deterministic projection still reports the evaluation errors.
	projectionBody, err := json.Marshal(map[string]any{
		"settings": map[string]any{
			"fallbackProjectionStartDate": "2026-03-10",
			"horizonYears":                1,
			"evaluations":                 types.EmptyEvaluationTables(),
		},
		"range": map[string]any{"startDate": "2000-01-01", "endDate": "2100-01-01"},
	})
	if err != nil {
		t.Fatalf("encode projection body: %v", err)
	}
	projection := doRowRequest(t, handler, http.MethodPost, "/v1/projections/deterministic", string(projectionBody))
	if projection.Code != http.StatusOK {
		t.Fatalf("projection status = %d, body %s", projection.Code, projection.Body.String())
	}
	var projectionPayload struct {
		Result *types.ProjectionResult      `json:"result"`
		Issues []types.ModelValidationIssue `json:"issues"`
	}
	if err := json.Unmarshal(projection.Body.Bytes(), &projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if projectionPayload.Result != nil {
		t.Fatal("projection must not return a result with an invalid forecast")
	}
	for _, want := range []string{"evaluation.config.invalid", "evaluation.accountBalance.accountId.invalid"} {
		if !financeHasIssueCode(projection.Body.Bytes(), want) {
			t.Fatalf("projection must report %s, got %+v", want, projectionPayload.Issues)
		}
	}

	// Deleting the referenced (otherwise unused) savings account still
	// rejects without changing data or revision.
	deleted := doRowRequest(t, handler, http.MethodDelete, "/v1/accounts/"+savingsID, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete account status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	var deletedPayload struct {
		Persisted bool   `json:"persisted"`
		Revision  string `json:"revision"`
	}
	if err := json.Unmarshal(deleted.Body.Bytes(), &deletedPayload); err != nil {
		t.Fatalf("decode delete: %v", err)
	}
	if deletedPayload.Persisted {
		t.Fatal("deleting a referenced account must not persist")
	}
	if !financeHasIssueCode(deleted.Body.Bytes(), "evaluation.accountBalance.accountId.invalid") {
		t.Fatalf("delete must report the new orphan, got %s", deleted.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("reload model: %v", err)
	}
	kept := false
	for _, account := range model.Accounts {
		if account.ID == savingsID {
			kept = true
		}
	}
	if !kept {
		t.Fatal("rejected delete removed the account")
	}
	after := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-03-10", "")
	var afterPayload struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(after.Body.Bytes(), &afterPayload); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	if afterPayload.Revision != deletedPayload.Revision {
		t.Fatalf("rejected delete changed revision %q to %q", deletedPayload.Revision, afterPayload.Revision)
	}
	if afterPayload.Revision == revisionBefore {
		t.Fatalf("expected the persisted patches to advance revision from %q", revisionBefore)
	}
}
