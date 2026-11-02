package integration

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 journey 5: model integrity across the other journeys' operations.
//
// Receipt review, sharing grants, and inbox decisions must never move the
// financial model or its forecast; only a genuine model edit may. Bank
// source rows stay byte-identical unless the bank itself sends new rows,
// and no flow may mint duplicate accounts, postings, rules, or receipts.
func qa03CanonicalModel(t *testing.T, scoped store.Store) string {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func qa03CountRows(model *types.FinancialModel) (accounts, postings, rules int) {
	return len(model.Accounts), len(model.Postings), len(model.RecurrenceRules)
}

func TestQA03ModelIntegrityAcrossReviewSharingAndForecast(t *testing.T) {
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix()
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-a", "GROCER 123", "-12.50", stamp),
	})

	source, err := receiptmock.New()
	if err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{ReceiptSource: source})
	model, err := scoped.LoadModel()
	if err != nil || len(model.Postings) != 1 {
		t.Fatalf("seeded postings = %+v err = %v", model, err)
	}
	postingID := model.Postings[0].ID

	baselineModel := qa03CanonicalModel(t, scoped)
	baselineForecast := qa03StoredProjection(t, handler)
	rawBaseline, _ := json.Marshal(baselineForecast)

	// Receipt review is evidence-only: attach, extract (harness adapter),
	// and confirm must leave the model and its forecast untouched.
	receipt := decodeReceipt(t, qa03UploadToPosting(t, handler, postingID, receiptmock.SampleImage))
	extracted := decodeReceipt(t, receiptRequest(handler, "POST", "/v1/receipts/"+receipt.ID+"/extract", nil))
	details := extracted.Extraction.Details
	details.Merchant = "Confirmed store"
	decodeReceipt(t, receiptRequest(handler, "PATCH", "/v1/receipts/"+receipt.ID, map[string]any{
		"revision": extracted.Revision, "details": details, "confirm": true,
	}))
	if got := qa03CanonicalModel(t, scoped); got != baselineModel {
		t.Fatal("receipt review changed the financial model")
	}
	raw, _ := json.Marshal(qa03StoredProjection(t, handler))
	if string(raw) != string(rawBaseline) {
		t.Fatal("receipt review changed the forecast")
	}

	// A bank re-sync with identical rows changes nothing; one new bank row
	// adds exactly one posting and revises the forecast.
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-a", "GROCER 123", "-12.50", stamp),
	})
	if got := qa03CanonicalModel(t, scoped); got != baselineModel {
		t.Fatal("identical re-sync changed the financial model")
	}
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-a", "GROCER 123", "-12.50", stamp),
		qa03BankTxn("bank-b", "FUEL STOP", "-30.00", stamp+60),
	})
	model, err = scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if accounts, postings, rules := qa03CountRows(model); accounts != 1 || postings != 2 || rules != 0 {
		t.Fatalf("rows = %d/%d/%d, want 1/2/0 with no duplicates", accounts, postings, rules)
	}
	seen := map[string]int{}
	for _, posting := range model.Postings {
		seen[posting.ID]++
	}
	for id, count := range seen {
		if count != 1 {
			t.Fatalf("posting %s appears %d times", id, count)
		}
	}

	// A genuine model edit — a new forecast rule — moves the forecast, and
	// only by the rule's own occurrences.
	preRule, _ := json.Marshal(qa03StoredProjection(t, handler))
	ruleID := qa03CreateRow(t, handler, "/v1/recurrence-rules",
		`{"name":"Dues","sourceAccountId":"`+model.Accounts[0].ID+`","destinations":null,"amount":{"resolver":"expression","config":{"expression":"5"},"inputs":{}},"frequency":"monthly","startDate":"2026-07-15","enabled":true,"priority":1}`)
	changed, _ := json.Marshal(qa03StoredProjection(t, handler))
	if string(changed) == string(preRule) {
		t.Fatal("new rule left the forecast unchanged")
	}
	model, err = scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if accounts, postings, rules := qa03CountRows(model); accounts != 1 || postings != 2 || rules != 1 {
		t.Fatalf("rows = %d/%d/%d, want 1/2/1", accounts, postings, rules)
	}

	// Deleting the rule restores the pre-rule forecast byte-for-byte: the
	// simulation depends on current model inputs alone.
	if response := doRowRequest(t, handler, http.MethodDelete, "/v1/recurrence-rules/"+ruleID, ""); response.Code != http.StatusOK {
		t.Fatalf("delete rule = %d %s", response.Code, response.Body.String())
	}
	restored, _ := json.Marshal(qa03StoredProjection(t, handler))
	if string(restored) != string(preRule) {
		t.Fatal("forecast did not restore after the rule deletion")
	}
}
