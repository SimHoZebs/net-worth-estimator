package types_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Category judgments never set an annualized estimate. The field must be
// omitted so the ML evidence parser keeps treating it as zero, and it must be
// present when an analysis producer supplies a value.
func TestJudgmentPatternAnnualizedEstimateOmittedWhenEmpty(t *testing.T) {
	category, err := json.Marshal(types.JudgmentPattern{Merchant: "shop", TypicalAmount: "10.00"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(category), "annualizedEstimate") {
		t.Fatalf("empty annualized estimate serialized for a category: %s", category)
	}

	payment, err := json.Marshal(types.JudgmentPattern{Merchant: "employer", AnnualizedEstimate: "52000.00"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payment), `"annualizedEstimate":"52000.00"`) {
		t.Fatalf("annualized estimate dropped for a payment: %s", payment)
	}
}
