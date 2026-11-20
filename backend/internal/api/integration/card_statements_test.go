package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

func createStatementTestAccount(t *testing.T, handler http.Handler, name, kind string) string {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"`+name+`","kind":"`+kind+`","enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("create %s status = %d, body %s", name, response.Code, response.Body.String())
	}
	var payload struct {
		Value struct {
			ID string `json:"id"`
		} `json:"value"`
		Saved bool `json:"saved"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	if !payload.Saved || payload.Value.ID == "" {
		t.Fatalf("create %s = %+v", name, payload)
	}
	return payload.Value.ID
}

func createDerivedCard(t *testing.T, handler http.Handler, closingDay int, balance float64, closeDate string) string {
	t.Helper()
	body := fmt.Sprintf(`{"name":"Card","kind":"credit_card","enabled":true,"statementClosingDay":%d,"balance":%g,"observedAt":%d}`,
		closingDay, balance, domain.DayCloseUnix(closeDate))
	response := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", body)
	if response.Code != http.StatusOK {
		t.Fatalf("create card status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Value struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Value.ID
}

func saveDueTerms(t *testing.T, handler http.Handler, accountID string, dueDay int) {
	t.Helper()
	body := fmt.Sprintf(`{"accountId":"%s","minimumFixed":25,"dueDay":%d}`, accountID, dueDay)
	response := doRowRequest(t, handler, http.MethodPost, "/v1/payment-terms", body)
	if response.Code != http.StatusOK {
		t.Fatalf("save terms status = %d, body %s", response.Code, response.Body.String())
	}
}

func createStatementTestRecord(t *testing.T, handler http.Handler, body string) string {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodPost, "/v1/transactions", body)
	if response.Code != http.StatusOK {
		t.Fatalf("create transaction status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Value struct {
			ID string `json:"id"`
		} `json:"value"`
		Saved bool `json:"saved"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode transaction: %v", err)
	}
	if !payload.Saved || payload.Value.ID == "" {
		t.Fatalf("create transaction = %+v", payload)
	}
	return payload.Value.ID
}

type listedStatement struct {
	ID        string  `json:"id"`
	AccountID string  `json:"accountId"`
	Closing   string  `json:"closingDate"`
	DueDate   *string `json:"dueDate"`
	Balance   *float64 `json:"balance"`
	Kind      string  `json:"kind"`
}

type listedRead struct {
	Statement listedStatement `json:"statement"`
	Remaining float64         `json:"remaining"`
	Allocated float64         `json:"allocated"`
}

func listDerivedStatements(t *testing.T, handler http.Handler, accountID string) ([]listedRead, string) {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodGet, "/v1/card-statements?accountId="+accountID, "")
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Statements []listedRead `json:"statements"`
		Revision   string       `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	return payload.Statements, payload.Revision
}

func findDerivedStatement(t *testing.T, reads []listedRead, closingDate string) listedRead {
	t.Helper()
	for _, read := range reads {
		if read.Statement.Closing == closingDate {
			return read
		}
	}
	t.Fatalf("statement for %s not found in %+v", closingDate, reads)
	return listedRead{}
}

func TestCardStatementsEndToEnd(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	checking := createStatementTestAccount(t, handler, "Checking", "cash")
	card := createDerivedCard(t, handler, 31, -100.30, "2026-01-31")
	saveDueTerms(t, handler, card, 20)

	payment := createStatementTestRecord(t, handler, `{"name":"Card payoff","sourceAccountId":"`+checking+`","destinations":["`+card+`"],"amount":{"resolver":"expression","config":{"expression":"60.20"},"inputs":{}},"date":"2026-01-31","enabled":true}`)

	reads, _ := listDerivedStatements(t, handler, card)
	statement := findDerivedStatement(t, reads, "2026-01-31")
	if statement.Statement.ID != "2026-01-31~"+card {
		t.Fatalf("derived id = %q", statement.Statement.ID)
	}
	if statement.Statement.Balance == nil || *statement.Statement.Balance != 100.30 || statement.Statement.Kind != "closed" {
		t.Fatalf("statement = %+v, want 100.30 closed", statement.Statement)
	}
	if statement.Statement.DueDate == nil || *statement.Statement.DueDate != "2026-02-20" {
		t.Fatalf("due date = %v, want 2026-02-20", statement.Statement.DueDate)
	}
	if statement.Remaining != 100.30 || statement.Allocated != 0 {
		t.Fatalf("totals = %+v, want 0 allocated and 100.30 remaining", statement)
	}

	candidates := doRowRequest(t, handler, http.MethodGet, "/v1/card-statements/"+statement.Statement.ID+"/payment-candidates", "")
	if candidates.Code != http.StatusOK {
		t.Fatalf("candidates status = %d, body %s", candidates.Code, candidates.Body.String())
	}
	var candidatePayload struct {
		Candidates []struct {
			TransactionID string  `json:"transactionId"`
			Amount        float64 `json:"amount"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(candidates.Body.Bytes(), &candidatePayload); err != nil {
		t.Fatalf("decode candidates: %v", err)
	}
	if len(candidatePayload.Candidates) != 1 || candidatePayload.Candidates[0].TransactionID != payment {
		t.Fatalf("candidates = %+v, want the card payoff", candidatePayload)
	}

	suggestions := doRowRequest(t, handler, http.MethodGet, "/v1/transactions/"+payment+"/statement-payment-suggestions", "")
	if suggestions.Code != http.StatusOK {
		t.Fatalf("suggestions status = %d, body %s", suggestions.Code, suggestions.Body.String())
	}
	var suggestionPayload struct {
		TransactionID string `json:"transactionId"`
		Matches       []struct {
			Read struct {
				Statement struct{ ID string } `json:"statement"`
				Remaining float64             `json:"remaining"`
			} `json:"read"`
		} `json:"matches"`
		Current *struct {
			ID string `json:"id"`
		} `json:"current"`
		Result struct {
			Status string `json:"status"`
		} `json:"result"`
	}
	if err := json.Unmarshal(suggestions.Body.Bytes(), &suggestionPayload); err != nil {
		t.Fatalf("decode suggestions: %v", err)
	}
	if len(suggestionPayload.Matches) != 1 || suggestionPayload.Matches[0].Read.Statement.ID != statement.Statement.ID {
		t.Fatalf("suggestions = %+v, want one match for the statement", suggestionPayload)
	}
	if suggestionPayload.Result.Status != "unallocated" || suggestionPayload.Current != nil {
		t.Fatalf("initial result = %+v", suggestionPayload)
	}

	// Apply a first partial payment. Integer-cent math must leave 60.20.
	first := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statement.Statement.ID+"/allocations",
		`{"transactionId":"`+payment+`","amount":40.10,"evidence":"partial test"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first allocation status = %d, body %s", first.Code, first.Body.String())
	}
	reads, _ = listDerivedStatements(t, handler, card)
	afterFirst := findDerivedStatement(t, reads, "2026-01-31")
	if afterFirst.Remaining != 60.20 || afterFirst.Allocated != 40.10 {
		t.Fatalf("remaining after 40.10 = %+v, want 60.20", afterFirst)
	}
}

func TestCardStatementsValidationAndUndoReapply(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	checking := createStatementTestAccount(t, handler, "Checking", "cash")
	card := createDerivedCard(t, handler, 31, -100.30, "2026-01-31")
	saveDueTerms(t, handler, card, 20)
	payment := createStatementTestRecord(t, handler, `{"name":"Card payoff","sourceAccountId":"`+checking+`","destinations":["`+card+`"],"amount":{"resolver":"expression","config":{"expression":"100.30"},"inputs":{}},"date":"2026-02-01","enabled":true}`)
	statementID := "2026-01-31~" + card

	// There is no manual statement path: a synthetic id cannot be allocated.
	missing := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/2026-01-31~ghost/allocations",
		`{"transactionId":"`+payment+`","amount":1,"evidence":"x"}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown statement status = %d, want 404: %s", missing.Code, missing.Body.String())
	}

	subCent := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":1.001,"evidence":"x"}`)
	if subCent.Code != http.StatusUnprocessableEntity {
		t.Fatalf("sub-cent allocation status = %d, want 422: %s", subCent.Code, subCent.Body.String())
	}

	applied := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":100.30,"evidence":"full"}`)
	if applied.Code != http.StatusOK {
		t.Fatalf("apply status = %d, body %s", applied.Code, applied.Body.String())
	}
	var allocation struct {
		Allocation struct{ ID, StatementID, State string } `json:"allocation"`
	}
	if err := json.Unmarshal(applied.Body.Bytes(), &allocation); err != nil {
		t.Fatal(err)
	}
	if allocation.Allocation.StatementID != statementID {
		t.Fatalf("allocation statement id = %q, want %q", allocation.Allocation.StatementID, statementID)
	}
	allocationID := allocation.Allocation.ID

	second := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":1,"evidence":"duplicate"}`)
	if second.Code != http.StatusConflict {
		t.Fatalf("second apply status = %d, want 409", second.Code)
	}

	dismiss := doRowRequest(t, handler, http.MethodPatch, "/v1/statement-allocations/"+allocationID, `{"state":"dismissed"}`)
	if dismiss.Code != http.StatusOK {
		t.Fatalf("dismiss status = %d, body %s", dismiss.Code, dismiss.Body.String())
	}
	events := doRowRequest(t, handler, http.MethodGet, "/v1/statement-allocations/"+allocationID+"/events", "")
	var eventPayload struct {
		Events []struct{ Action string } `json:"events"`
	}
	if err := json.Unmarshal(events.Body.Bytes(), &eventPayload); err != nil {
		t.Fatal(err)
	}
	if len(eventPayload.Events) != 2 {
		t.Fatalf("events after dismiss = %+v, want created and dismissed", eventPayload.Events)
	}

	reapply := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":100.30,"evidence":"applied again"}`)
	if reapply.Code != http.StatusOK {
		t.Fatalf("reapply status = %d, body %s", reapply.Code, reapply.Body.String())
	}
	var reapplied struct {
		Allocation struct{ ID, State string } `json:"allocation"`
	}
	if err := json.Unmarshal(reapply.Body.Bytes(), &reapplied); err != nil {
		t.Fatal(err)
	}
	if reapplied.Allocation.ID != allocationID || reapplied.Allocation.State != "confirmed" {
		t.Fatalf("reapply = %+v, want the same row restored", reapplied)
	}

	kindEdit := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+card, `{"name":"Card","kind":"cash","enabled":true}`)
	if kindEdit.Code != http.StatusConflict {
		t.Fatalf("kind edit with live allocation status = %d, want 409: %s", kindEdit.Code, kindEdit.Body.String())
	}
}
