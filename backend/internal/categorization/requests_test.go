package categorization

import (
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func kindsOf(requests []types.AnalysisJudgmentInput) map[string]bool {
	kinds := map[string]bool{}
	for _, request := range requests {
		kinds[request.Kind] = true
	}
	return kinds
}

func TestCategoryJudgmentRequestsAreDeterministic(t *testing.T) {
	input := Input{
		TransactionID: "txn-one",
		Name:          "WHOLE FOODS MARKET",
		Direction:     "out",
		Facts:         &types.TransactionFacts{Description: "GROCERY", Amount: "-42.00", Currency: "USD"},
	}
	first := CategoryJudgmentRequests(input)
	second := CategoryJudgmentRequests(input)
	if len(first) == 0 {
		t.Fatal("expected at least one request")
	}
	if len(first) != len(second) {
		t.Fatalf("lengths differ: %d vs %d", len(first), len(second))
	}
	for index := range first {
		if first[index].ID != second[index].ID {
			t.Fatalf("request %d IDs differ: %s vs %s", index, first[index].ID, second[index].ID)
		}
	}
}

func TestCategoryJudgmentRequestsGateOnDirection(t *testing.T) {
	inflow := CategoryJudgmentRequests(Input{TransactionID: "in", Name: "ONLINE TRANSFER", Direction: "in"})
	kinds := kindsOf(inflow)
	if kinds["category:TRANSFER_OUT"] {
		t.Fatalf("inflow emitted TRANSFER_OUT: %+v", kinds)
	}
	if !kinds["category:TRANSFER_IN"] {
		t.Fatalf("inflow missed TRANSFER_IN: %+v", kinds)
	}
	outflow := CategoryJudgmentRequests(Input{TransactionID: "out", Name: "ACME PAYROLL", Direction: "out"})
	kinds = kindsOf(outflow)
	if kinds["category:INCOME"] || kinds["category:TRANSFER_IN"] {
		t.Fatalf("outflow emitted inflow kinds: %+v", kinds)
	}
}

func TestCategoryJudgmentRequestsPrefilterBound(t *testing.T) {
	requests := CategoryJudgmentRequests(Input{TransactionID: "plain", Name: "XYZ", Direction: "out"})
	if len(requests) != 0 {
		t.Fatalf("signal-free transaction emitted %d requests", len(requests))
	}
}

func TestCategoryJudgmentRequestsCarryEvidence(t *testing.T) {
	requests := CategoryJudgmentRequests(Input{
		TransactionID: "txn-evidence",
		Name:          "SHELL OIL",
		Direction:     "out",
		Facts:         &types.TransactionFacts{Amount: "not-a-number", Currency: "USD"},
	})
	if len(requests) != 1 || requests[0].Kind != "category:TRANSPORTATION" {
		t.Fatalf("requests=%+v", requests)
	}
	request := requests[0]
	if request.Pattern.OccurrenceCount != 1 || request.Pattern.Direction != "outflow" {
		t.Fatalf("pattern=%+v", request.Pattern)
	}
	if request.Pattern.TypicalAmount != "0" {
		t.Fatalf("unparsable amount kept: %q", request.Pattern.TypicalAmount)
	}
	if request.Question.SuggestWithoutSignal || len(request.Question.RequiredSignals) != 0 {
		t.Fatalf("question=%+v", request.Question)
	}
	if len(request.Samples) != 1 {
		t.Fatalf("samples=%+v", request.Samples)
	}
	long := strings.Repeat("x", 300)
	requests = CategoryJudgmentRequests(Input{TransactionID: "txn-long", Name: "SHELL " + long, Direction: "out"})
	if merchant := requests[0].Pattern.Merchant; len([]rune(merchant)) != 256 {
		t.Fatalf("merchant length=%d", len([]rune(merchant)))
	}
}

func TestCategoryJudgmentRequestsAbsNormalizeSignedAmounts(t *testing.T) {
	requests := CategoryJudgmentRequests(Input{
		TransactionID: "txn-signed",
		Name:          "SHELL OIL",
		Direction:     "out",
		Facts:         &types.TransactionFacts{Description: "GAS", Amount: "-42.00", Currency: "USD"},
	})
	if len(requests) != 1 || requests[0].Kind != "category:TRANSPORTATION" {
		t.Fatalf("requests=%+v", requests)
	}
	// Bank amounts are signed; the learner evidence layer requires a
	// non-negative magnitude, so the builder emits the absolute value.
	if requests[0].Pattern.TypicalAmount != "42.00" {
		t.Fatalf("signed amount kept: %q", requests[0].Pattern.TypicalAmount)
	}
}
