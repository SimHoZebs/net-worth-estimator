package analysis

import (
	"context"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func observationTx(id, description, amount string, day int64) types.AnalysisTransaction {
	return types.AnalysisTransaction{TransactionID: id, AccountID: "bank", SourceProvider: "fixture", Facts: types.TransactionFacts{Description: description, Amount: amount, Currency: "USD", OccurredAt: day * 86400}}
}

func TestAssessmentsAreIndependentIntersections(t *testing.T) {
	for _, tc := range []struct {
		name, description, amount string
		days                      []int64
		purpose, repeats          bool
	}{
		{"single rent", "RENT LANDLORD", "-1800", []int64{20000}, true, false},
		{"single payroll", "ACME PAYROLL", "2000", []int64{20000}, true, false},
		{"unmarked single", "UNKNOWN", "2000", []int64{20000}, false, false},
		{"unknown repeating outflow", "UNKNOWN", "-40", []int64{20000, 20030, 20061}, false, true},
		{"repeating rent", "RENT LANDLORD", "-1800", []int64{20000, 20030, 20061}, true, true},
		{"irregular rent", "RENT LANDLORD", "-1800", []int64{20000, 20003, 20070}, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := types.AnalysisSnapshot{UserID: "owner", Revision: 1}
			for i, day := range tc.days {
				input.Transactions = append(input.Transactions, observationTx(string(rune('a'+i)), tc.description, tc.amount, day))
			}
			ctx := withPaymentObservations(context.Background())
			purpose, err := (PaymentPatterns{}).Analyze(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			repeats, err := (Recurring{}).Analyze(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			if (len(purpose) > 0) != tc.purpose || (len(repeats) > 0) != tc.repeats {
				t.Fatalf("purpose=%d repeating=%d", len(purpose), len(repeats))
			}
			if tc.purpose && !tc.repeats && (purpose[0].Product != "" || purpose[0].Pattern.AnnualizedEstimate != "") {
				t.Fatal("invented recurrence or annualization")
			}
			if tc.purpose && tc.repeats && purpose[0].StreamID != repeats[0].StreamID {
				t.Fatal("independent assessments do not share evidence identity")
			}
			cache := ctx.Value(observationsKey{}).(*observationCache)
			cached := cache.streams[0]
			streams, err := detectPaymentStreams(ctx, input)
			if err != nil || streams[0] != cached {
				t.Fatal("reextracted the same owner revision")
			}
			input.UserID = "another-owner"
			other, err := detectPaymentStreams(ctx, input)
			if err != nil || other[0].streamID == cached.streamID {
				t.Fatal("cache leaked across owners")
			}
		})
	}
}

func TestClassificationCanExplicitlyRequireRecurrence(t *testing.T) {
	definition := PaymentClassification{ID: "repeating-rent", Label: "repeating rent", Direction: "outflow", SupportSignals: []string{"rent-descriptor"}, RequireRecurrence: true}
	input := types.AnalysisSnapshot{UserID: "owner", Transactions: []types.AnalysisTransaction{observationTx("a", "RENT", "-1800", 20000)}}
	f, err := (PaymentPatterns{Classifications: []PaymentClassification{definition}}).Analyze(context.Background(), input)
	if err != nil || len(f) != 0 {
		t.Fatal("classification ignored its own prerequisite")
	}
	input.Transactions = append(input.Transactions, observationTx("b", "RENT", "-1800", 20030), observationTx("c", "RENT", "-1800", 20061))
	f, err = (PaymentPatterns{Classifications: []PaymentClassification{definition}}).Analyze(context.Background(), input)
	if err != nil || len(f) != 3 || len(f[0].JudgmentInput.Question.RequiredSignals) != 1 || f[0].JudgmentInput.Question.RequiredSignals[0] != "regular-cadence" {
		t.Fatalf("recurrence prerequisite was not recorded in the question: %v %+v", err, f)
	}
}

func TestPurposeRetainsObservationsOutsideRecurrenceCohort(t *testing.T) {
	input := types.AnalysisSnapshot{UserID: "owner", Transactions: []types.AnalysisTransaction{
		observationTx("a", "LANDLORD RENT", "-1800", 20000),
		observationTx("b", "LANDLORD RENT", "-1800", 20030),
		observationTx("c", "LANDLORD RENT", "-1800", 20061),
		observationTx("d", "LANDLORD RENT", "-2400", 20070),
	}}
	ctx := withPaymentObservations(context.Background())
	purpose, err := (PaymentPatterns{}).Analyze(ctx, input)
	if err != nil || len(purpose) != 4 {
		t.Fatalf("purpose dropped eligible observations: %v %+v", err, purpose)
	}
	repetition, err := (Recurring{}).Analyze(ctx, input)
	if err != nil || len(repetition) != 3 {
		t.Fatalf("repetition included an outlier: %v %+v", err, repetition)
	}
	for _, finding := range purpose {
		if finding.StreamID != repetition[0].StreamID {
			t.Fatal("cohorts lost shared identity")
		}
		if finding.TransactionID == "d" {
			if finding.Product != "" || finding.Pattern.AnnualizedEstimate != "" || finding.JudgmentInput.Pattern.OccurrenceCount != 1 {
				t.Fatalf("outlier borrowed recurrence: %+v", finding)
			}
		} else if finding.Product != "monthly" || finding.Pattern.AnnualizedEstimate == "" {
			t.Fatalf("repeating cohort lost cadence: %+v", finding)
		}
	}
}

func TestRecurrenceRetainsTransfersAndRefundsWhilePurposeSelectsExternalEvidence(t *testing.T) {
	for _, description := range []string{"ACME PAYROLL", "ACME PAYROLL REFUND"} {
		t.Run(description, func(t *testing.T) {
			input := types.AnalysisSnapshot{UserID: "owner"}
			for i, day := range []int64{20000, 20030, 20061} {
				id := string(rune('a' + i))
				input.Transactions = append(input.Transactions, observationTx(id, description, "2000", day))
				if description == "ACME PAYROLL" {
					leg := observationTx(id+"-opposite", "TRANSFER", "-2000", day)
					leg.AccountID = "other-bank"
					input.Transactions = append(input.Transactions, leg)
				}
			}
			ctx := withPaymentObservations(context.Background())
			purpose, err := (PaymentPatterns{}).Analyze(ctx, input)
			if err != nil || len(purpose) != 0 {
				t.Fatalf("external-only purpose included transfer or refund: %v %+v", err, purpose)
			}
			repetition, err := (Recurring{}).Analyze(ctx, input)
			if err != nil || len(repetition) < 3 {
				t.Fatalf("repetition lost raw evidence: %v %+v", err, repetition)
			}
			definition := PaymentClassification{ID: "raw", Label: "raw", Direction: "inflow", SupportSignals: []string{"payroll-descriptor"}}
			raw, err := (PaymentPatterns{Classifications: []PaymentClassification{definition}}).Analyze(ctx, input)
			if err != nil || len(raw) != 3 {
				t.Fatalf("definition could not select raw evidence: %v %+v", err, raw)
			}
		})
	}
}
