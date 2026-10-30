package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Intent writes: one frontend call persists every row its abstraction owns,
// atomically. The frontend no longer sequences CRUD calls for these intents.

func decodeRowResult[T any](t *testing.T, code int, body []byte) rowResultBody[T] {
	t.Helper()
	if code != http.StatusOK {
		t.Fatalf("status = %d, body %s", code, body)
	}
	var result rowResultBody[T]
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return result
}

func TestCreateAccountWithBalanceWritesCheckpoint(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	response := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Checking","kind":"cash","enabled":true,"balance":2500,"observedAt":1772409599}`)
	created := decodeRowResult[types.Account](t, response.Code, response.Body.Bytes())
	if !created.Persisted || created.Row.ID == "" {
		t.Fatalf("create = %+v", created)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Accounts) != 1 || model.Accounts[0].ID != created.Row.ID {
		t.Fatalf("accounts = %+v", model.Accounts)
	}
	if len(model.Checkpoints) != 1 {
		t.Fatalf("checkpoints = %+v, want the opening observation", model.Checkpoints)
	}
	got := model.Checkpoints[0]
	if got.AccountID != created.Row.ID || got.ObservedAt != 1772409599 || got.Balance != 2500 || got.Source != store.SourceUser {
		t.Fatalf("checkpoint = %+v", got)
	}
	assertSavedModelIdentity(t, database, created.Revision)
}

func TestAccountBalanceValidation(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	// Balance without an observation date is rejected before any write.
	rejected := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Checking","kind":"cash","enabled":true,"balance":2500}`)
	if rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body %s", rejected.Code, rejected.Body.String())
	}
	// Observed date without a balance is rejected too.
	rejected = doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/checking",
		`{"name":"Checking","kind":"cash","enabled":true,"observedAt":1772409599}`)
	if rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422, body %s", rejected.Code, rejected.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if model != nil && (len(model.Accounts) != 0 || len(model.Checkpoints) != 0) {
		t.Fatalf("rejected writes must leave no rows: %+v", model)
	}
}

func TestUpdateAccountWithMovedBalance(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true,"balance":100,"observedAt":1767311999}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d, body %s", created.Code, created.Body.String())
	}
	updated := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/checking",
		`{"name":"Checking","kind":"cash","enabled":true,"balance":200,"observedAt":1769990399}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d, body %s", updated.Code, updated.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v, want both observations", model.Checkpoints)
	}
	// Balance omitted: the account updates without touching checkpoints.
	renamed := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/checking",
		`{"name":"Renamed","kind":"cash","enabled":true}`)
	if renamed.Code != http.StatusOK {
		t.Fatalf("rename status = %d, body %s", renamed.Code, renamed.Body.String())
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Checkpoints) != 2 || model.Accounts[0].Name != "Renamed" {
		t.Fatalf("rename must not write checkpoints: %+v", model)
	}
	// Updating a missing account writes nothing, including no checkpoint.
	missing := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/ghost",
		`{"name":"Ghost","kind":"cash","enabled":true,"balance":1,"observedAt":1772409599}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body %s", missing.Code, missing.Body.String())
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Checkpoints) != 2 {
		t.Fatalf("failed update must not write checkpoints: %+v", model.Checkpoints)
	}
}

func ruleRequestBody(t *testing.T, handler interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, method, path, body string) rowResultBody[types.RecurrenceRule] {
	t.Helper()
	response := doRowRequest(t, handler, method, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("%s %s status = %d, body %s", method, path, response.Code, response.Body.String())
	}
	var result rowResultBody[types.RecurrenceRule]
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return result
}

func TestCreateRuleDefaultsPriority(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	base := `{"name":"%s","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"enabled":true%s}`
	first := ruleRequestBody(t, handler, http.MethodPost, "/v1/recurrence-rules", fmt.Sprintf(base, "First", ""))
	if !first.Persisted || first.Row.Priority != 0 {
		t.Fatalf("first rule = %+v", first)
	}
	second := ruleRequestBody(t, handler, http.MethodPost, "/v1/recurrence-rules", fmt.Sprintf(base, "Second", ""))
	if second.Row.Priority != 1 {
		t.Fatalf("second rule priority = %d, want 1", second.Row.Priority)
	}
	explicit := ruleRequestBody(t, handler, http.MethodPost, "/v1/recurrence-rules", fmt.Sprintf(base, "Explicit", `,"priority":10`))
	if explicit.Row.Priority != 10 {
		t.Fatalf("explicit rule priority = %d, want 10", explicit.Row.Priority)
	}
}

func TestUpdateRuleKeepsUnmodeledFields(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	created := ruleRequestBody(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"id":"rule-1","name":"Rule","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"enabled":true,"priority":7,"annualCap":500}`)
	if created.Row.Priority != 7 || created.Row.AnnualCap == nil || *created.Row.AnnualCap != 500 {
		t.Fatalf("created rule = %+v", created.Row)
	}
	updated := ruleRequestBody(t, handler, http.MethodPatch, "/v1/recurrence-rules/rule-1",
		`{"name":"Renamed","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"enabled":true}`)
	if updated.Row.Name != "Renamed" {
		t.Fatalf("updated rule = %+v", updated.Row)
	}
	if updated.Row.Priority != 7 {
		t.Fatalf("priority = %d, want stored 7 kept", updated.Row.Priority)
	}
	if updated.Row.AnnualCap == nil || *updated.Row.AnnualCap != 500 {
		t.Fatalf("annualCap = %+v, want stored 500 kept", updated.Row.AnnualCap)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	stored := model.RecurrenceRules[0]
	if stored.Priority != 7 || stored.AnnualCap == nil || *stored.AnnualCap != 500 {
		t.Fatalf("stored rule = %+v", stored)
	}
}

func TestUpdateEvaluationMovesType(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := doRowRequest(t, handler, http.MethodPost, "/v1/evaluations",
		`{"type":"netWorthThreshold","instanceId":"goal","name":"Goal","enabled":true,"config":{"target":1000}}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d, body %s", created.Code, created.Body.String())
	}
	pinned := doRowRequest(t, handler, http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":["goal"]}`)
	if pinned.Code != http.StatusOK {
		t.Fatalf("pin status = %d, body %s", pinned.Code, pinned.Body.String())
	}
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	moved := doRowRequest(t, handler, http.MethodPatch, "/v1/evaluations/goal",
		`{"type":"accountBalance","name":"Goal","enabled":true,"config":{"target":500,"accountId":"checking"}}`)
	if moved.Code != http.StatusOK {
		t.Fatalf("move status = %d, body %s", moved.Code, moved.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Evaluations.NetWorthThreshold) != 0 {
		t.Fatalf("old table = %+v, want empty", model.Evaluations.NetWorthThreshold)
	}
	if len(model.Evaluations.AccountBalance) != 1 || model.Evaluations.AccountBalance[0].InstanceID != "goal" {
		t.Fatalf("new table = %+v", model.Evaluations.AccountBalance)
	}
	pins, err := database.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("pins: %v", err)
	}
	if len(pins) != 1 || pins[0] != "goal" {
		t.Fatalf("pins = %+v, want the pin to survive the move", pins)
	}
	unknown := doRowRequest(t, handler, http.MethodPatch, "/v1/evaluations/goal",
		`{"type":"nope","name":"Goal","enabled":true,"config":{}}`)
	if unknown.Code != http.StatusInternalServerError {
		t.Fatalf("unknown type status = %d, want 500, body %s", unknown.Code, unknown.Body.String())
	}
}

func TestConvertTransactionAcrossTables(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	ruleBody := `{"name":"Invest","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"enabled":true}`
	created := ruleRequestBody(t, handler, http.MethodPost, "/v1/recurrence-rules", ruleBody)
	convert := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Row.ID+"/convert",
		`{"kind":"posting","posting":{"name":"Invest","sourceAccountId":"checking","postedTime":1782950400,"transactionTime":1782950400,"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},"enabled":true}}`)
	if convert.Code != http.StatusOK {
		t.Fatalf("convert status = %d, body %s", convert.Code, convert.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.RecurrenceRules) != 0 {
		t.Fatalf("rules = %+v, want the old row gone", model.RecurrenceRules)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != created.Row.ID || model.Postings[0].Name != "Invest" {
		t.Fatalf("postings = %+v", model.Postings)
	}

	back := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Row.ID+"/convert",
		`{"kind":"rule","rule":`+ruleBody+`}`)
	if back.Code != http.StatusOK {
		t.Fatalf("convert back status = %d, body %s", back.Code, back.Body.String())
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Postings) != 0 || len(model.RecurrenceRules) != 1 {
		t.Fatalf("round trip tables = %+v / %+v", model.Postings, model.RecurrenceRules)
	}

	sameKind := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Row.ID+"/convert",
		`{"kind":"rule","rule":`+ruleBody+`}`)
	if sameKind.Code != http.StatusUnprocessableEntity {
		t.Fatalf("same-kind status = %d, want 422, body %s", sameKind.Code, sameKind.Body.String())
	}
	missing := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/ghost/convert",
		`{"kind":"posting","posting":{"name":"Ghost","sourceAccountId":"checking","postedTime":1,"transactionTime":1,"amount":{"resolver":"expression","config":{"expression":"1"},"inputs":{}},"enabled":true}}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404, body %s", missing.Code, missing.Body.String())
	}
	badKind := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Row.ID+"/convert",
		`{"kind":"ledger"}`)
	if badKind.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad kind status = %d, want 422, body %s", badKind.Code, badKind.Body.String())
	}
}

func TestConvertTransactionRespectsReadOnly(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})
	blocked := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/x/convert", `{"kind":"posting"}`)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", blocked.Code)
	}
}

func TestUpdateKeepsEchoedDestinations(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	for _, account := range []string{"checking", "savings"} {
		seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
			`{"id":"`+account+`","name":"`+account+`","kind":"cash","enabled":true}`)
		if seeded.Code != http.StatusOK {
			t.Fatalf("seed account status = %d", seeded.Code)
		}
	}
	storedDestinations := func() []string {
		t.Helper()
		model, err := database.LoadModel()
		if err != nil {
			t.Fatalf("load: %v", err)
		}
		if len(model.Postings) != 1 {
			t.Fatalf("postings = %+v, want 1", model.Postings)
		}
		return model.Postings[0].Destinations
	}
	amount := `{"resolver":"expression","config":{"expression":"10"},"inputs":{}}`
	postingBody := func(destinations string) string {
		return `{"name":"Split","destinations":` + destinations +
			`,"postedTime":1782950400,"transactionTime":1782950400,"amount":` + amount + `,"enabled":true}`
	}
	create := doRowRequest(t, handler, http.MethodPost, "/v1/postings", postingBody(`["checking","savings"]`))
	created := decodeRowResult[types.Posting](t, create.Code, create.Body.Bytes())
	if len(created.Row.Destinations) != 2 {
		t.Fatalf("created destinations = %+v, want both legs", created.Row.Destinations)
	}
	// An unchanged display echo keeps the stored multi-destination set: the
	// row endpoints carry a single display destination, so the echo cannot
	// express intent to trim.
	echo := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Row.ID, postingBody(`["checking"]`))
	updated := decodeRowResult[types.Posting](t, echo.Code, echo.Body.Bytes())
	if len(updated.Row.Destinations) != 2 {
		t.Fatalf("echoed destinations = %+v, want stored legs kept", updated.Row.Destinations)
	}
	if got := storedDestinations(); len(got) != 2 {
		t.Fatalf("stored destinations = %+v, want stored legs kept", got)
	}
	// An explicit change still replaces the set verbatim.
	moved := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Row.ID, postingBody(`["savings"]`))
	replaced := decodeRowResult[types.Posting](t, moved.Code, moved.Body.Bytes())
	if len(replaced.Row.Destinations) != 1 || replaced.Row.Destinations[0] != "savings" {
		t.Fatalf("changed destinations = %+v, want [savings]", replaced.Row.Destinations)
	}

	ruleBody := func(destinations string) string {
		return `{"name":"SplitRule","destinations":` + destinations +
			`,"frequency":"monthly","startDate":"2026-01-01","amount":` + amount + `,"enabled":true}`
	}
	ruleCreate := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules", ruleBody(`["checking","savings"]`))
	createdRule := decodeRowResult[types.RecurrenceRule](t, ruleCreate.Code, ruleCreate.Body.Bytes())
	ruleEcho := doRowRequest(t, handler, http.MethodPatch, "/v1/recurrence-rules/"+createdRule.Row.ID, ruleBody(`["checking"]`))
	updatedRule := decodeRowResult[types.RecurrenceRule](t, ruleEcho.Code, ruleEcho.Body.Bytes())
	if len(updatedRule.Row.Destinations) != 2 {
		t.Fatalf("rule echoed destinations = %+v, want stored legs kept", updatedRule.Row.Destinations)
	}

	// Convert echoes the display destination the same way, in both directions.
	splitCreate := doRowRequest(t, handler, http.MethodPost, "/v1/postings", postingBody(`["checking","savings"]`))
	split := decodeRowResult[types.Posting](t, splitCreate.Code, splitCreate.Body.Bytes())
	toRule := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+split.Row.ID+"/convert",
		`{"kind":"rule","rule":`+ruleBody(`["checking"]`)+`}`)
	if toRule.Code != http.StatusOK {
		t.Fatalf("convert status = %d, body %s", toRule.Code, toRule.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	for _, existing := range model.RecurrenceRules {
		if existing.ID == split.Row.ID && len(existing.Destinations) != 2 {
			t.Fatalf("converted rule destinations = %+v, want echoed legs kept", existing.Destinations)
		}
	}
	back := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+split.Row.ID+"/convert",
		`{"kind":"posting","posting":`+postingBody(`["checking"]`)+`}`)
	if back.Code != http.StatusOK {
		t.Fatalf("convert back status = %d, body %s", back.Code, back.Body.String())
	}
	model, err = database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	for _, existing := range model.Postings {
		if existing.ID == split.Row.ID && len(existing.Destinations) != 2 {
			t.Fatalf("converted posting destinations = %+v, want echoed legs kept", existing.Destinations)
		}
	}
}
