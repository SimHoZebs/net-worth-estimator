package analysis

import (
	"context"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func transaction(id, description, amount string, day int) types.AnalysisTransaction {
	return types.AnalysisTransaction{PostingID: id, AccountID: "bank", Facts: types.TransactionFacts{Description: description, Amount: amount, Currency: "USD", PostedTime: time.Date(2026, 1, day, 12, 0, 0, 0, time.UTC).Unix(), Metadata: map[string]string{}}}
}

func TestBNPLDescriptorEvidence(t *testing.T) {
	for _, test := range []struct {
		name, text, amount, role string
		detected                 bool
	}{
		{"explicit product", "PAYPAL PAY IN 4", "-25.00", "repayment", true},
		{"normalized product", "PAYPAL pay-in-four", "-25.00", "repayment", true},
		{"installments", "KLARNA INSTALLMENT PAYMENT", "-25.00", "repayment", true},
		{"provider only", "KLARNA", "-25", "", false},
		{"generic processor", "PAYPAL STORE", "-25", "", false},
		{"immediate payment", "KLARNA PAY NOW", "-25", "", false},
		{"conflicting product", "KLARNA PAY NOW PAY IN 4", "-25", "", false},
		{"unknown provider", "STORE PAY IN 4", "-25", "", false},
		{"conflicting identities", "KLARNA PAYPAL PAY IN 4", "-25", "", false},
		{"refund", "KLARNA PAY IN 4 REFUND", "25", "refund", true},
		{"credit is not automatically refund", "KLARNA PAY IN 4", "25", "unknown", true},
		{"invalid amount", "KLARNA PAY IN 4", "NaN", "", false},
		{"name substring", "AFFIRMATION PAY IN 4", "-25", "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := (BNPL{}).Analyze(context.Background(), types.AnalysisSnapshot{Transactions: []types.AnalysisTransaction{transaction("one", test.text, test.amount, 1)}})
			if err != nil || (len(result) > 0) != test.detected {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if test.detected && (result[0].Role != test.role || result[0].Strength != "strong" || len(result[0].Evidence) == 0) {
				t.Fatalf("finding=%+v", result[0])
			}
		})
	}
}

func TestBNPLPatternAndLifecycle(t *testing.T) {
	items := []types.AnalysisTransaction{transaction("a", "KLARNA", "-25", 1), transaction("b", "KLARNA", "-25", 15), transaction("c", "KLARNA", "-25", 29)}
	check := func(want int) {
		t.Helper()
		result, err := (BNPL{}).Analyze(context.Background(), types.AnalysisSnapshot{Transactions: items})
		if err != nil || len(result) != want {
			t.Fatalf("got %d want %d err=%v", len(result), want, err)
		}
		for _, item := range result {
			if item.Strength != "moderate" || len(item.Evidence[0].PostingIDs) != 3 {
				t.Fatalf("pattern=%+v", item)
			}
		}
	}
	check(3)
	items[2].Pending = true
	check(0)
	items[2].Pending = false
	items[2].Void = true
	check(0)
	items[2].Void = false
	items[2].AccountID = "different"
	check(0)
	items[2].AccountID = "bank"
	for i := range items {
		items[i].Facts.Description = "PAYPAL"
	}
	check(0)
	for i := range items {
		items[i].Facts.Description = "KLARNA"
		items[i].Facts.Currency = "EUR"
	}
	check(0)
}

func TestBNPLSourceCategoryAndCancellation(t *testing.T) {
	item := transaction("one", "UNKNOWN", "-25", 1)
	item.Facts.Metadata["category"] = "LOAN_PAYMENTS_BNPL"
	result, err := (BNPL{}).Analyze(context.Background(), types.AnalysisSnapshot{Transactions: []types.AnalysisTransaction{item}})
	if err != nil || len(result) != 1 || result[0].Evidence[0].Code != "bnpl.source-category" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (BNPL{}).Analyze(ctx, types.AnalysisSnapshot{Transactions: []types.AnalysisTransaction{item}}); err != context.Canceled {
		t.Fatalf("cancellation=%v", err)
	}
}
