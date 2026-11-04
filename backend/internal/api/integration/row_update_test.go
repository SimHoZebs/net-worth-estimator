package integration

import (
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Partial row updates: absent members keep their stored value, null clears a
// nullable member, and an explicit change replaces only that member. The
// editor states what changed instead of restating the whole row.

func seedPatchAccounts(t *testing.T, handler http.Handler) {
	t.Helper()
	for _, account := range []string{"checking", "savings"} {
		seeded := doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
			`{"id":"`+account+`","name":"`+account+`","kind":"cash","enabled":true}`)
		if seeded.Code != http.StatusOK {
			t.Fatalf("seed account status = %d, body %s", seeded.Code, seeded.Body.String())
		}
	}
}

func TestPostingUpdateLeavesAbsentMembersUntouched(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seedPatchAccounts(t, handler)

	rule := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"id":"salary","name":"Salary","sourceAccountId":null,"destinations":["checking"],"amount":{"value":1200},"frequency":"monthly","startDate":"2026-01-01","enabled":true}`)
	if rule.Code != http.StatusOK {
		t.Fatalf("seed rule status = %d, body %s", rule.Code, rule.Body.String())
	}
	create := doRowRequest(t, handler, http.MethodPost, "/v1/postings", `{
		"name":"Rent","sourceAccountId":"checking","destinations":["savings"],
		"amount":{"value":1200},"postedTime":1785542400,"transactionTime":1785542400,
		"claim":{"ruleId":"salary","occurrenceDate":"2026-02-01"},"enabled":true}`)
	created := decodeWriteResult[types.Posting](t, create.Code, create.Body.Bytes())
	if !created.Saved {
		t.Fatalf("create issues = %+v, want saved", created.Issues)
	}

	// One member changes; every other member keeps the stored value.
	patched := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Result.ID, `{"enabled":false}`)
	row := decodeWriteResult[types.Posting](t, patched.Code, patched.Body.Bytes())
	if row.Result.Enabled {
		t.Fatal("enabled = true after patch, want false")
	}
	if row.Result.Name != "Rent" || row.Result.PostedTime != 1785542400 || row.Result.TransactionTime != 1785542400 {
		t.Fatalf("patched row = %+v, want untouched name and times", row.Result)
	}
	if row.Result.Claim == nil || row.Result.Claim.RuleID != "salary" {
		t.Fatalf("claim = %+v, want stored claim kept", row.Result.Claim)
	}
	if row.Result.SourceAccountID == nil || *row.Result.SourceAccountID != "checking" {
		t.Fatalf("source = %+v, want checking kept", row.Result.SourceAccountID)
	}

	// Null clears a nullable member.
	cleared := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Result.ID, `{"claim":null,"sourceAccountId":null}`)
	clean := decodeWriteResult[types.Posting](t, cleared.Code, cleared.Body.Bytes())
	if clean.Result.Claim != nil {
		t.Fatalf("claim = %+v, want cleared", clean.Result.Claim)
	}
	if clean.Result.SourceAccountID != nil {
		t.Fatalf("source = %+v, want cleared", clean.Result.SourceAccountID)
	}

	// A semantic amount replaces only the amount descriptor.
	repriced := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Result.ID, `{"amount":{"value":25.5}}`)
	priced := decodeWriteResult[types.Posting](t, repriced.Code, repriced.Body.Bytes())
	expression, _ := priced.Result.Amount.Config["expression"].(string)
	if expression != "25.5" {
		t.Fatalf("amount expression = %q, want 25.5", expression)
	}
	if priced.Result.PostedTime != 1785542400 {
		t.Fatalf("postedTime = %d, want untouched", priced.Result.PostedTime)
	}

	// An empty patch is a valid no-op.
	noop := doRowRequest(t, handler, http.MethodPatch, "/v1/postings/"+created.Result.ID, `{}`)
	if noop.Code != http.StatusOK {
		t.Fatalf("empty patch status = %d, body %s", noop.Code, noop.Body.String())
	}
}

func TestRuleUpdateClearsNullableMembersAndKeepsOthers(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seedPatchAccounts(t, handler)

	create := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules", `{
		"name":"Invest","sourceAccountId":"checking","destinations":["savings"],
		"amount":{"value":900,"annualIncrease":2},"frequency":"monthly",
		"startDate":"2026-01-05","endDate":"2027-01-05","annualCap":12000,"priority":4,"enabled":true}`)
	created := decodeWriteResult[types.RecurrenceRule](t, create.Code, create.Body.Bytes())

	// Clear both nullable optionals in one patch.
	cleared := doRowRequest(t, handler, http.MethodPatch, "/v1/recurrence-rules/"+created.Result.ID, `{"endDate":null,"annualCap":null}`)
	clearedRow := decodeWriteResult[types.RecurrenceRule](t, cleared.Code, cleared.Body.Bytes())
	if clearedRow.Result.EndDate != nil || clearedRow.Result.AnnualCap != nil {
		t.Fatalf("row = %+v, want end date and cap cleared", clearedRow.Result)
	}
	if clearedRow.Result.Frequency != "monthly" || clearedRow.Result.StartDate != "2026-01-05" || clearedRow.Result.Priority != 4 {
		t.Fatalf("row = %+v, want untouched schedule and priority", clearedRow.Result)
	}

	// A cadence-only patch leaves the amount descriptor untouched.
	cadence := doRowRequest(t, handler, http.MethodPatch, "/v1/recurrence-rules/"+created.Result.ID, `{"frequency":"annual"}`)
	cadenceRow := decodeWriteResult[types.RecurrenceRule](t, cadence.Code, cadence.Body.Bytes())
	if cadenceRow.Result.Frequency != "annual" {
		t.Fatalf("frequency = %q, want annual", cadenceRow.Result.Frequency)
	}
	expression, _ := cadenceRow.Result.Amount.Config["expression"].(string)
	if expression != "(900) * growth" {
		t.Fatalf("amount expression = %q, want stored growth descriptor", expression)
	}

	// A semantic amount with growth compiles to the stored descriptor.
	repriced := doRowRequest(t, handler, http.MethodPatch, "/v1/recurrence-rules/"+created.Result.ID, `{"amount":{"value":950,"annualIncrease":3}}`)
	priced := decodeWriteResult[types.RecurrenceRule](t, repriced.Code, repriced.Body.Bytes())
	expression, _ = priced.Result.Amount.Config["expression"].(string)
	if expression != "(950) * growth" {
		t.Fatalf("amount expression = %q, want (950) * growth", expression)
	}
	growth := priced.Result.Amount.Inputs["growth"]
	rate, _ := growth.Arguments["annualGrowthRate"].(float64)
	if growth.Provider != "growth-factor" || rate != 0.03 {
		t.Fatalf("growth input = %+v, want growth-factor at 0.03", growth)
	}
}

func TestCreateBodiesAcceptSemanticAmounts(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	seedPatchAccounts(t, handler)

	posting := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Groceries","sourceAccountId":"checking","destinations":["savings"],"amount":{"value":42.5},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	created := decodeWriteResult[types.Posting](t, posting.Code, posting.Body.Bytes())
	if !created.Saved {
		t.Fatalf("posting issues = %+v, want saved", created.Issues)
	}
	expression, _ := created.Result.Amount.Config["expression"].(string)
	if expression != "42.5" || created.Result.Amount.Resolver != "expression" {
		t.Fatalf("posting amount = %+v, want expression 42.5", created.Result.Amount)
	}

	rule := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"name":"Salary","sourceAccountId":null,"destinations":["checking"],"amount":{"value":1200,"annualIncrease":2.5},"frequency":"monthly","startDate":"2026-02-01","enabled":true}`)
	createdRule := decodeWriteResult[types.RecurrenceRule](t, rule.Code, rule.Body.Bytes())
	expression, _ = createdRule.Result.Amount.Config["expression"].(string)
	if expression != "(1200) * growth" {
		t.Fatalf("rule amount expression = %q, want (1200) * growth", expression)
	}
	rate, _ := createdRule.Result.Amount.Inputs["growth"].Arguments["annualGrowthRate"].(float64)
	if rate != 0.025 {
		t.Fatalf("growth rate = %v, want 0.025", rate)
	}

	// A stored descriptor replays verbatim during model import.
	replayed := doRowRequest(t, handler, http.MethodPost, "/v1/recurrence-rules",
		`{"name":"Imported","sourceAccountId":null,"destinations":["checking"],"amount":{"resolver":"expression","config":{"expression":"1+1"},"inputs":{}},"frequency":"monthly","startDate":"2026-03-01","enabled":true}`)
	replayedRow := decodeWriteResult[types.RecurrenceRule](t, replayed.Code, replayed.Body.Bytes())
	expression, _ = replayedRow.Result.Amount.Config["expression"].(string)
	if expression != "1+1" {
		t.Fatalf("replayed expression = %q, want stored 1+1", expression)
	}

	// Growth on a one-time posting is rejected rather than stored.
	growthPosting := doRowRequest(t, handler, http.MethodPost, "/v1/postings",
		`{"name":"Grows","sourceAccountId":"checking","destinations":["savings"],"amount":{"value":10,"annualIncrease":1},"postedTime":1785542400,"transactionTime":1785542400,"enabled":true}`)
	if growthPosting.Code != http.StatusUnprocessableEntity {
		t.Fatalf("growth posting status = %d, want 422, body %s", growthPosting.Code, growthPosting.Body.String())
	}
}
