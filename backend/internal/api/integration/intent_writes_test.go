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

func decodeWriteResult[T any](t *testing.T, code int, body []byte) writeResult[T] {
	t.Helper()
	if code != http.StatusOK {
		t.Fatalf("status = %d, body %s", code, body)
	}
	var result writeResult[T]
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
	created := decodeWriteResult[types.Account](t, response.Code, response.Body.Bytes())
	if !created.Saved || created.Result.ID == "" {
		t.Fatalf("create = %+v", created)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Accounts) != 1 || model.Accounts[0].ID != created.Result.ID {
		t.Fatalf("accounts = %+v", model.Accounts)
	}
	if len(model.Checkpoints) != 1 {
		t.Fatalf("checkpoints = %+v, want the opening observation", model.Checkpoints)
	}
	got := model.Checkpoints[0]
	if got.AccountID != created.Result.ID || got.ObservedAt != 1772409599 || got.Balance != 2500 || got.Source != store.SourceUser {
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
}, method, path, body string) writeResult[types.Schedule] {
	t.Helper()
	response := doRowRequest(t, handler, method, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("%s %s status = %d, body %s", method, path, response.Code, response.Body.String())
	}
	var result writeResult[types.Schedule]
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return result
}

func TestCreateScheduleDefaultsPriority(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	base := `{"name":"%s","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"enabled":true%s}`
	first := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules", fmt.Sprintf(base, "First", ""))
	if !first.Saved || first.Result.Priority != 0 {
		t.Fatalf("first rule = %+v", first)
	}
	second := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules", fmt.Sprintf(base, "Second", ""))
	if second.Result.Priority != 1 {
		t.Fatalf("second rule priority = %d, want 1", second.Result.Priority)
	}
	explicit := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules", fmt.Sprintf(base, "Explicit", `,"priority":10`))
	if explicit.Result.Priority != 10 {
		t.Fatalf("explicit rule priority = %d, want 10", explicit.Result.Priority)
	}
}

func TestUpdateScheduleKeepsUnmodeledFields(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	created := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules",
		`{"id":"rule-1","name":"Rule","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-01","amount":{"resolver":"expression","config":{"expression":"10"},"inputs":{}},"enabled":true,"priority":7,"annualCap":500}`)
	if created.Result.Priority != 7 || created.Result.AnnualCap == nil || *created.Result.AnnualCap != 500 {
		t.Fatalf("created rule = %+v", created.Result)
	}
	updated := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules/rule-1/amend",
		`{"name":"Renamed"}`)
	if updated.Result.Name != "Renamed" {
		t.Fatalf("updated rule = %+v", updated.Result)
	}
	if updated.Result.Priority != 7 {
		t.Fatalf("priority = %d, want stored 7 kept", updated.Result.Priority)
	}
	if updated.Result.AnnualCap == nil || *updated.Result.AnnualCap != 500 {
		t.Fatalf("annualCap = %+v, want stored 500 kept", updated.Result.AnnualCap)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	stored := model.Schedules[0]
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

func TestStartScheduleFromTransactionKeepsFact(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	for _, account := range []string{"checking", "savings"} {
		seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
			`{"id":"`+account+`","name":"`+account+`","kind":"cash","enabled":true}`)
		if seeded.Code != http.StatusOK {
			t.Fatalf("seed account status = %d", seeded.Code)
		}
	}
	created := doRowRequest(t, handler, http.MethodPost, "/v1/transactions",
		`{"name":"Rent","sourceAccountId":"checking","destinations":["savings"],"amount":{"value":100},"date":"2026-07-02","enabled":true}`)
	if created.Code != http.StatusOK {
		t.Fatalf("record status = %d, body %s", created.Code, created.Body.String())
	}
	recorded := decodeWriteResult[types.Posting](t, created.Code, created.Body.Bytes())
	if !recorded.Saved {
		t.Fatalf("record issues = %+v", recorded.Issues)
	}
	started := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+recorded.Result.ID+"/schedule",
		`{"frequency":"monthly","startDate":"2026-07-02"}`)
	if started.Code != http.StatusOK {
		t.Fatalf("schedule-from-transaction status = %d, body %s", started.Code, started.Body.String())
	}
	schedule := decodeWriteResult[types.Schedule](t, started.Code, started.Body.Bytes())
	if !schedule.Saved || schedule.Result.Frequency != "monthly" || schedule.Result.StartDate != "2026-07-02" {
		t.Fatalf("schedule = %+v", schedule)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != recorded.Result.ID {
		t.Fatalf("postings = %+v, want the recorded transaction kept", model.Postings)
	}
	if model.Postings[0].Claim == nil || model.Postings[0].Claim.ScheduleID != schedule.Result.ID ||
		model.Postings[0].Claim.OccurrenceDate != "2026-07-02" {
		t.Fatalf("claim = %+v, want the first occurrence", model.Postings[0].Claim)
	}
	if len(model.Schedules) != 1 || model.Schedules[0].ID != schedule.Result.ID {
		t.Fatalf("schedules = %+v", model.Schedules)
	}
	again := doRowRequest(t, handler, http.MethodPost,
		"/v1/transactions/"+recorded.Result.ID+"/schedule",
		`{"frequency":"monthly","startDate":"2026-07-02"}`)
	if again.Code != http.StatusUnprocessableEntity {
		t.Fatalf("second start status = %d, want 422, body %s", again.Code, again.Body.String())
	}
	after, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(after.Schedules) != 1 ||
		after.Postings[0].Claim == nil ||
		after.Postings[0].Claim.ScheduleID != schedule.Result.ID {
		t.Fatalf("second start changed the model: schedules=%+v claim=%+v", after.Schedules, after.Postings[0].Claim)
	}
}

func TestEndScheduleWithTransactionRecordsFact(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	created := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules",
		`{"name":"Gym","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-05","amount":{"value":45},"enabled":true}`)
	ended := doRowRequest(t, handler, http.MethodPost, "/v1/schedules/"+created.Result.ID+"/end-with-transaction",
		`{"date":"2026-07-05"}`)
	if ended.Code != http.StatusOK {
		t.Fatalf("end status = %d, body %s", ended.Code, ended.Body.String())
	}
	var body struct {
		Result          types.Posting `json:"value"`
		EndedScheduleID string        `json:"endedScheduleId"`
		Saved           bool          `json:"saved"`
	}
	if err := json.Unmarshal(ended.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Saved || body.EndedScheduleID != created.Result.ID || body.Result.Name != "Gym" {
		t.Fatalf("ended = %+v", body)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Schedules) != 0 {
		t.Fatalf("schedules = %+v, want none", model.Schedules)
	}
	if len(model.Postings) != 1 || model.Postings[0].Name != "Gym" || model.Postings[0].TransactionTime <= 0 {
		t.Fatalf("postings = %+v, want the recorded fact", model.Postings)
	}
}

func TestDeleteScheduleReleasesClaims(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"id":"checking","name":"Checking","kind":"cash","enabled":true}`)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed account status = %d", seeded.Code)
	}
	created := ruleRequestBody(t, handler, http.MethodPost, "/v1/schedules",
		`{"name":"Gym","sourceAccountId":"checking","frequency":"monthly","startDate":"2026-01-05","amount":{"value":45},"enabled":true}`)
	transaction := doRowRequest(t, handler, http.MethodPost, "/v1/transactions",
		`{"name":"Gym visit","sourceAccountId":"checking","amount":{"value":45},"date":"2026-01-05","enabled":true,"claim":{"scheduleId":"`+created.Result.ID+`","occurrenceDate":"2026-01-05"}}`)
	if transaction.Code != http.StatusOK {
		t.Fatalf("record status = %d, body %s", transaction.Code, transaction.Body.String())
	}
	deleted := doRowRequest(t, handler, http.MethodDelete, "/v1/schedules/"+created.Result.ID, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(model.Schedules) != 0 {
		t.Fatalf("schedules = %+v, want none", model.Schedules)
	}
	if len(model.Postings) != 1 || model.Postings[0].Claim != nil {
		t.Fatalf("postings = %+v, want the fact without a claim", model.Postings)
	}
}

func TestActionWritesRespectReadOnly(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})
	for _, target := range []string{
		"/v1/transactions/x/amend",
		"/v1/transactions/x/claim",
		"/v1/transactions/x/schedule",
		"/v1/schedules/x/amend",
		"/v1/schedules/x/end-with-transaction",
	} {
		blocked := doRowRequest(t, handler, http.MethodPost, target, `{}`)
		if blocked.Code != http.StatusForbidden {
			t.Fatalf("%s status = %d, want 403", target, blocked.Code)
		}
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
			`,"date":"2026-07-02","amount":` + amount + `,"enabled":true}`
	}
	create := doRowRequest(t, handler, http.MethodPost, "/v1/transactions", postingBody(`["checking","savings"]`))
	created := decodeWriteResult[types.Posting](t, create.Code, create.Body.Bytes())
	if len(created.Result.Destinations) != 2 {
		t.Fatalf("created destinations = %+v, want both legs", created.Result.Destinations)
	}
	// A patch that omits destinations keeps the stored multi-destination set:
	// the editor states only the members an edit changes, so an untouched
	// route can never trim legs it never modeled.
	renamed := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Result.ID+"/amend", `{"name":"Split renamed"}`)
	updated := decodeWriteResult[types.Posting](t, renamed.Code, renamed.Body.Bytes())
	if updated.Result.Name != "Split renamed" {
		t.Fatalf("patched name = %q, want Split renamed", updated.Result.Name)
	}
	if len(updated.Result.Destinations) != 2 {
		t.Fatalf("patched destinations = %+v, want stored legs kept", updated.Result.Destinations)
	}
	if got := storedDestinations(); len(got) != 2 {
		t.Fatalf("stored destinations = %+v, want stored legs kept", got)
	}
	// An explicit destinations member replaces the set verbatim.
	moved := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+created.Result.ID+"/amend", `{"destinations":["savings"]}`)
	replaced := decodeWriteResult[types.Posting](t, moved.Code, moved.Body.Bytes())
	if len(replaced.Result.Destinations) != 1 || replaced.Result.Destinations[0] != "savings" {
		t.Fatalf("changed destinations = %+v, want [savings]", replaced.Result.Destinations)
	}

	ruleBody := func(destinations string) string {
		return `{"name":"SplitRule","destinations":` + destinations +
			`,"frequency":"monthly","startDate":"2026-01-01","amount":` + amount + `,"enabled":true}`
	}
	ruleCreate := doRowRequest(t, handler, http.MethodPost, "/v1/schedules", ruleBody(`["checking","savings"]`))
	createdRule := decodeWriteResult[types.Schedule](t, ruleCreate.Code, ruleCreate.Body.Bytes())
	ruleEcho := doRowRequest(t, handler, http.MethodPost, "/v1/schedules/"+createdRule.Result.ID+"/amend", `{"name":"SplitRule renamed"}`)
	updatedRule := decodeWriteResult[types.Schedule](t, ruleEcho.Code, ruleEcho.Body.Bytes())
	if len(updatedRule.Result.Destinations) != 2 {
		t.Fatalf("patched rule destinations = %+v, want stored legs kept", updatedRule.Result.Destinations)
	}
	if updatedRule.Result.Amount.Resolver != "expression" {
		t.Fatalf("patched rule amount = %+v, want stored descriptor kept", updatedRule.Result.Amount)
	}

	// Starting a schedule from a recorded transaction carries the stored
	// multi-destination set into the new instruction.
	splitCreate := doRowRequest(t, handler, http.MethodPost, "/v1/transactions", postingBody(`["checking","savings"]`))
	split := decodeWriteResult[types.Posting](t, splitCreate.Code, splitCreate.Body.Bytes())
	toSchedule := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+split.Result.ID+"/schedule",
		`{"frequency":"monthly","startDate":"2026-04-01"}`)
	if toSchedule.Code != http.StatusOK {
		t.Fatalf("start schedule status = %d, body %s", toSchedule.Code, toSchedule.Body.String())
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	for _, existing := range model.Schedules {
		if existing.Name == split.Result.Name && len(existing.Destinations) != 2 {
			t.Fatalf("started schedule destinations = %+v, want both legs kept", existing.Destinations)
		}
	}
}
