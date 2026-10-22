package types

import (
	"reflect"
	"testing"
)

func TestRemapPostingReferencesPreservesNamesAndExpressionInputs(t *testing.T) {
	amount := PostingAmountResolution{
		Resolver: "expression", Config: map[string]any{"expression": "old_payment + fee"},
		Inputs: map[string]AmountInputBinding{
			"old_payment": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "old-payment"}},
			"fee":         {Source: "provider", Provider: "late-fee", Arguments: map[string]any{"payment": "old-payment", "account": "checking"}},
		},
	}
	document := FinancialModelDocument{
		Postings:        []Posting{{ID: "old-payment", Name: "old-payment", Amount: amount}},
		RecurrenceRules: []RecurrenceRule{{ID: "rule", Amount: amount}},
		Evaluations:     EmptyEvaluationTables(),
	}
	document.Evaluations.PostingFulfillment = []FulfillmentEvaluation{{InstanceID: "fulfillment", Config: map[string]any{"postingIds": []any{"old-payment"}, "label": "old-payment"}}}
	document.Evaluations.FinancialIndependence = []FIEvaluation{{InstanceID: "fi", Config: map[string]any{"continuingPostingIds": []any{"old-payment", "rule"}}}}
	RemapPostingReferences(&document, map[string]string{"old-payment": "new-uuid"})
	if document.Postings[0].ID != "new-uuid" || document.Postings[0].Name != "old-payment" {
		t.Fatal("identity rewrite changed the posting name")
	}
	for _, rewritten := range []PostingAmountResolution{document.Postings[0].Amount, document.RecurrenceRules[0].Amount} {
		if rewritten.Config["expression"] != "old_payment + fee" || rewritten.Inputs["old_payment"].Arguments["id"] != "new-uuid" || rewritten.Inputs["fee"].Arguments["payment"] != "new-uuid" || rewritten.Inputs["fee"].Arguments["account"] != "checking" {
			t.Fatalf("amount references = %+v", rewritten)
		}
	}
	fulfillment := document.Evaluations.PostingFulfillment[0].Config.(map[string]any)
	if !reflect.DeepEqual(fulfillment["postingIds"], []any{"new-uuid"}) || fulfillment["label"] != "old-payment" {
		t.Fatalf("fulfillment references = %+v", fulfillment)
	}
	fi := document.Evaluations.FinancialIndependence[0].Config.(map[string]any)
	if !reflect.DeepEqual(fi["continuingPostingIds"], []any{"new-uuid", "rule"}) {
		t.Fatalf("FI references = %+v", fi)
	}
}

func TestRemapPostingReferencesFICashflowSources(t *testing.T) {
	document := FinancialModelDocument{Evaluations: EmptyEvaluationTables()}
	document.Evaluations.FinancialIndependence = []FIEvaluation{{Config: map[string]any{
		"sources": []any{
			map[string]any{"type": "cashflow", "postingId": "old-payment", "included": true},
			map[string]any{"type": "cashflow", "postingId": "old-payment", "included": false},
			map[string]any{"type": "cashflow", "postingId": "unchanged", "included": true},
			map[string]any{"type": "asset", "accountId": "old-payment", "postingId": "old-payment", "included": true},
		},
		"label": "old-payment",
	}}}
	document.Evaluations.PostingFulfillment = []FulfillmentEvaluation{{Config: map[string]any{
		"sources": []any{map[string]any{"type": "cashflow", "postingId": "old-payment"}},
	}}}
	RemapPostingReferences(&document, map[string]string{"old-payment": "new-uuid"})
	fi := document.Evaluations.FinancialIndependence[0].Config.(map[string]any)
	want := []any{
		map[string]any{"type": "cashflow", "postingId": "new-uuid", "included": true},
		map[string]any{"type": "cashflow", "postingId": "new-uuid", "included": false},
		map[string]any{"type": "cashflow", "postingId": "unchanged", "included": true},
		map[string]any{"type": "asset", "accountId": "old-payment", "postingId": "old-payment", "included": true},
	}
	if !reflect.DeepEqual(fi["sources"], want) || fi["label"] != "old-payment" {
		t.Fatalf("FI sources = %+v", fi)
	}
	other := document.Evaluations.PostingFulfillment[0].Config.(map[string]any)
	if other["sources"].([]any)[0].(map[string]any)["postingId"] != "old-payment" {
		t.Fatal("rewrote sources outside financial-independence configuration")
	}
}
