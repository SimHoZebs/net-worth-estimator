package integration

import (
	"encoding/json"
	"net/http"
	"testing"
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

func TestCardStatementsEndToEnd(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	checking := createStatementTestAccount(t, handler, "Checking", "cash")
	card := createStatementTestAccount(t, handler, "Card", "credit_card")

	payment := createStatementTestRecord(t, handler, `{"name":"Card payoff","sourceAccountId":"`+checking+`","destinations":["`+card+`"],"amount":{"resolver":"expression","config":{"expression":"60.20"},"inputs":{}},"date":"2026-01-31","enabled":true}`)

	statementBody := `{"accountId":"` + card + `","closingDate":"2026-01-31","dueDate":"2026-02-20","balance":100.30,"currency":"USD"}`
	created := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements", statementBody)
	if created.Code != http.StatusOK {
		t.Fatalf("create statement status = %d, body %s", created.Code, created.Body.String())
	}
	var statementPayload struct {
		Statement struct {
			ID string `json:"id"`
		} `json:"statement"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &statementPayload); err != nil {
		t.Fatalf("decode statement: %v", err)
	}
	statementID := statementPayload.Statement.ID
	if statementID == "" {
		t.Fatalf("statement id empty in %s", created.Body.String())
	}

	listed := doRowRequest(t, handler, http.MethodGet, "/v1/card-statements?accountId="+card, "")
	if listed.Code != http.StatusOK {
		t.Fatalf("list status = %d, body %s", listed.Code, listed.Body.String())
	}
	var listPayload struct {
		Statements []struct {
			Statement struct{ Balance, Allocated, Remaining float64 } `json:"statement"`
			Remaining float64                                         `json:"remaining"`
			Allocated float64                                         `json:"allocated"`
		} `json:"statements"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listPayload.Statements) != 1 || listPayload.Statements[0].Remaining != 100.30 {
		t.Fatalf("list = %+v, want one statement with 100.30 remaining", listPayload)
	}

	candidates := doRowRequest(t, handler, http.MethodGet, "/v1/card-statements/"+statementID+"/payment-candidates", "")
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
	if len(suggestionPayload.Matches) != 1 || suggestionPayload.Matches[0].Read.Statement.ID != statementID {
		t.Fatalf("suggestions = %+v, want one match for the statement", suggestionPayload)
	}
	if suggestionPayload.Result.Status != "unallocated" || suggestionPayload.Current != nil {
		t.Fatalf("initial result = %+v", suggestionPayload)
	}

	// Apply a first partial payment. Integer-cent math must leave 60.20.
	first := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":40.10,"evidence":"partial test"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first allocation status = %d, body %s", first.Code, first.Body.String())
	}
	listed = doRowRequest(t, handler, http.MethodGet, "/v1/card-statements?accountId="+card, "")
	var afterFirst struct {
		Statements []struct {
			Remaining float64 `json:"remaining"`
		} `json:"statements"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &afterFirst); err != nil {
		t.Fatalf("decode list after first: %v", err)
	}
	if len(afterFirst.Statements) != 1 || afterFirst.Statements[0].Remaining != 60.20 {
		t.Fatalf("remaining after 40.10 = %+v, want 60.20", afterFirst)
	}
}

func TestCardStatementsValidationAndUndoReapply(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	checking := createStatementTestAccount(t, handler, "Checking", "cash")
	card := createStatementTestAccount(t, handler, "Card", "credit_card")
	payment := createStatementTestRecord(t, handler, `{"name":"Card payoff","sourceAccountId":"`+checking+`","destinations":["`+card+`"],"amount":{"resolver":"expression","config":{"expression":"100.30"},"inputs":{}},"date":"2026-02-01","enabled":true}`)

	badDate := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements",
		`{"accountId":"`+card+`","closingDate":"2026-02-20","dueDate":"2026-02-01","balance":100.30,"currency":"USD"}`)
	if badDate.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad date status = %d, want 422", badDate.Code)
	}
	subCent := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements",
		`{"accountId":"`+card+`","closingDate":"2026-01-31","dueDate":"2026-02-20","balance":100.305,"currency":"USD"}`)
	if subCent.Code != http.StatusUnprocessableEntity {
		t.Fatalf("sub-cent balance status = %d, want 422", subCent.Code)
	}
	wrongKind := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements",
		`{"accountId":"`+checking+`","closingDate":"2026-01-31","dueDate":"2026-02-20","balance":100.30,"currency":"USD"}`)
	if wrongKind.Code != http.StatusUnprocessableEntity {
		t.Fatalf("wrong kind status = %d, want 422", wrongKind.Code)
	}

	created := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements",
		`{"accountId":"`+card+`","closingDate":"2026-01-31","dueDate":"2026-02-20","balance":100.30,"currency":"USD"}`)
	var payload struct {
		Statement struct{ ID string } `json:"statement"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	statementID := payload.Statement.ID

	applied := doRowRequest(t, handler, http.MethodPost, "/v1/card-statements/"+statementID+"/allocations",
		`{"transactionId":"`+payment+`","amount":100.30,"evidence":"full"}`)
	if applied.Code != http.StatusOK {
		t.Fatalf("apply status = %d, body %s", applied.Code, applied.Body.String())
	}
	var allocation struct {
		Allocation struct{ ID string } `json:"allocation"`
	}
	if err := json.Unmarshal(applied.Body.Bytes(), &allocation); err != nil {
		t.Fatal(err)
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
