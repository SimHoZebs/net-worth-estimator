package categorization

import (
	"context"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestKeywordClassifierRecognizesCommonInputs(t *testing.T) {
	cases := []struct {
		name       string
		input      Input
		expected   string
		recognized bool
	}{
		{name: "payroll inflow", input: Input{PostingID: "pay", Name: "ACME PAYROLL", Direction: "in"}, expected: types.CategoryIncome, recognized: true},
		{name: "grocery", input: Input{PostingID: "food", Name: "WHOLE FOODS MARKET", Direction: "out"}, expected: types.CategoryFoodAndDrink, recognized: true},
		{name: "fuel", input: Input{PostingID: "gas", Name: "SHELL OIL", Direction: "out"}, expected: types.CategoryTransportation, recognized: true},
		{name: "installment provider", input: Input{PostingID: "bnpl", Name: "KLARNA PAY IN 4", Direction: "out"}, expected: types.CategoryLoanPayments, recognized: true},
		{name: "subscription", input: Input{PostingID: "tv", Name: "NETFLIX", Direction: "out"}, expected: types.CategoryEntertainment, recognized: true},
		{name: "transfer", input: Input{PostingID: "move", Name: "ONLINE TRANSFER", Direction: "out"}, expected: types.CategoryTransferOut, recognized: true},
		{name: "transfer in", input: Input{PostingID: "move-in", Name: "ONLINE TRANSFER", Direction: "in"}, expected: types.CategoryTransferIn, recognized: true},
		{name: "unknown", input: Input{PostingID: "unknown", Name: "LOCAL SHOP", Direction: "out"}, expected: "", recognized: false},
	}
	classifier := KeywordClassifier{}
	inputs := make([]Input, len(cases))
	for index, item := range cases {
		inputs[index] = item.input
	}
	results, err := classifier.Classify(context.Background(), inputs)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		got, ok := results[item.input.PostingID]
		if ok != item.recognized || got != item.expected {
			t.Fatalf("%s: got %q, %v; want %q, %v", item.name, got, ok, item.expected, item.recognized)
		}
	}
}

func TestKeywordClassifierUsesSourceEvidence(t *testing.T) {
	classifier := KeywordClassifier{}
	results, err := classifier.Classify(context.Background(), []Input{{
		PostingID: "one",
		Name:      "CARD PURCHASE",
		Direction: "out",
		Facts: &types.TransactionFacts{
			Metadata: map[string]string{"merchant_name": "TRADER JOES"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if results["one"] != types.CategoryFoodAndDrink {
		t.Fatalf("results=%+v", results)
	}
}

func TestKeywordClassifierStopsOnCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (KeywordClassifier{}).Classify(ctx, []Input{{PostingID: "one", Name: "WHOLE FOODS"}}); err == nil {
		t.Fatal("classify ignored cancellation")
	}
}
