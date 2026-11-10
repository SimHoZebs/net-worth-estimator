package analysis_test

import (
	"context"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPaymentReferencesDoNotSplitSourceDerivedCounterparties(t *testing.T) {
	items := rentTransactions("BILT PAYMENT BILTRENT")
	references := []string{"1abc234def56789", "2bcd345efa67890", "3cde456fab78901"}
	payees := []string{"Bilt Payment Biltrent Abc Def Web", "Bilt Payment Biltrent Bcd Efa Web", "Bilt Payment Biltrent Cde Fab Web"}
	for i := range items {
		items[i].Facts.Description += " " + references[i] + " WEB ID: XXXXXX1234"
		items[i].Facts.Payee = payees[i]
	}
	input := types.AnalysisSnapshot{UserID: "owner", Transactions: items}
	before, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), input)
	if err != nil || len(before) != 3 {
		t.Fatalf("reference-fragmented stream: findings=%d err=%v", len(before), err)
	}
	for _, f := range before {
		if f.Kind != "rent" || f.Strength != "strong" || f.Pattern.PatternID != before[0].Pattern.PatternID {
			t.Fatalf("wrong rent assessment: %+v", f)
		}
	}
	items[0].Facts.Description = "BILT PAYMENT BILTRENT 4def567abc89012 WEB ID: 9876541234"
	items[0].Facts.Payee = "Bilt Payment Biltrent Def Abc Web"
	after, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), input)
	if err != nil || len(after) != 3 || before[0].Pattern.PatternID != after[0].Pattern.PatternID {
		t.Fatal("reference change reidentified the stream")
	}
	if before[0].JudgmentInput.ID == after[0].JudgmentInput.ID {
		t.Fatal("immutable request ignored source reference change")
	}
}

func TestPaymentReferenceNormalizationPreservesIndependentPayeeProperties(t *testing.T) {
	for _, payees := range [][]string{
		{"North landlord", "South landlord"},
		{"Bilt Payment Biltrent North Web", "Bilt Payment Biltrent South Web"},
		// Hex-looking text that is not derived from the source reference is
		// descriptive evidence, not permission to erase another property.
		{"Bilt Payment Biltrent Cafe Web", "Bilt Payment Biltrent Feed Web"},
	} {
		var items []types.AnalysisTransaction
		for stream := 0; stream < 2; stream++ {
			part := rentTransactions("BILT PAYMENT BILTRENT 1abc234def56789 WEB ID: XXXXXX1234")
			for i := range part {
				part[i].TransactionID = payees[stream] + part[i].TransactionID
				part[i].Facts.Payee = payees[stream]
			}
			items = append(items, part...)
		}
		findings, err := (analysis.PaymentPatterns{}).Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: items})
		if err != nil || len(findings) != 6 {
			t.Fatalf("distinct counterparties merged: %d %v", len(findings), err)
		}
		if findings[0].Pattern.PatternID == findings[3].Pattern.PatternID {
			t.Fatal("independent payees share stream identity")
		}
	}
}
