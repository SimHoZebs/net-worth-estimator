package analysis_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestIncomeSeparatesPayrollFromOtherPaymentsBySameMerchant(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("salary-a", "AMAZON DEVELOPME PAYROLL PPD ID: 1234561103", "7500.00", incomeDay(2026, 8, 29)),
		incomeTx("salary-b", "AMAZON DEVELOPME PAYROLL PPD ID: 1234561103", "7400.00", incomeDay(2026, 9, 30)),
		incomeTx("salary-c", "AMAZON DEVELOPME PAYROLL PPD ID: XXXXXX1103", "7450.00", incomeDay(2026, 10, 30)),
		incomeTx("other-a", "Amazon Developme PAYMENTS TLR004632220712 CCD ID: 1234569299", "32.00", incomeDay(2026, 8, 17)),
		incomeTx("other-b", "Amazon Developme PAYMENTS TLR004509799212 CCD ID: 1234569299", "32.00", incomeDay(2026, 10, 19)),
		incomeTx("other-c", "Amazon Developme PAYMENTS TLRXXXXXXXX2172 CCD ID: XXXXXX9299", "32.00", incomeDay(2026, 11, 2)),
	}
	calls := 0
	detector := analysis.Income{Judge: incomeEvaluator(func(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
		calls++
		if len(requests) != 1 || requests[0].Pattern.OccurrenceCount != 3 || !requests[0].Pattern.PayrollDescriptor || requests[0].Pattern.TypicalAmount != "7450.00" {
			t.Fatalf("payroll did not reach the provider independently: %+v", requests)
		}
		return []types.AnalysisJudgment{{RequestID: requests[0].ID, Status: "ready", Strength: "strong"}}, nil
	})}
	findings, err := detector.Analyze(context.Background(), types.AnalysisSnapshot{UserID: "owner", Transactions: items})
	if err != nil || len(findings) != 3 || calls != 1 {
		t.Fatalf("findings=%+v calls=%d err=%v", findings, calls, err)
	}
	for _, finding := range findings {
		if finding.TransactionID[:6] != "salary" || finding.Product != "monthly" || finding.Income.AnnualizedEstimate != "89400.00" {
			t.Fatalf("unrelated payments contaminated payroll: %+v", finding)
		}
	}
}

func TestIncomeStreamIdentityUsesMoreThanFirstMerchantWord(t *testing.T) {
	for _, property := range []string{"description", "payee", "merchant_name", "category", "memo-payroll", "memo-only"} {
		t.Run(property, func(t *testing.T) {
			var items []types.AnalysisTransaction
			for stream := 0; stream < 2; stream++ {
				for i, day := range []int{2, 16, 30} {
					tx := incomeTx(fmt.Sprintf("%d-%d", stream, i), "ACME PAYMENT", "1000.00", incomeDay(2026, 1, day))
					switch property {
					case "description":
						tx.Facts.Description = fmt.Sprintf("ACME %s PAYROLL", []string{"NORTH", "SOUTH"}[stream])
					case "payee":
						tx.Facts.Payee = []string{"North employer", "South employer"}[stream]
					case "merchant_name":
						tx.Facts.Metadata["merchant_name"] = []string{"North employer", "South employer"}[stream]
					case "category":
						if stream == 0 {
							tx.Facts.Metadata["category"] = types.CategoryIncome
						}
					case "memo-payroll":
						if stream == 0 {
							tx.Facts.Memo = "Payroll"
						}
					case "memo-only":
						tx.Facts.Description = ""
						tx.Facts.Memo = []string{"ACME NORTH PAYROLL", "ACME SOUTH PAYROLL"}[stream]
					}
					items = append(items, tx)
				}
			}
			findings := analyzeIncome(t, items)
			if len(findings) != 6 {
				t.Fatalf("want two complete streams, got %+v", findings)
			}
			if findings[0].Income.PatternID == findings[3].Income.PatternID {
				t.Fatal("distinct streams share pattern identity")
			}
		})
	}
}

func TestIncomeStreamReferenceChangesDoNotSplitOrReidentifyPatterns(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "ACME BENEFIT PAYMENT REF: 123456", "500.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "ACME BENEFIT PAYMENT REF: XXXXXX", "500.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "ACME BENEFIT PAYMENT REF: 789012", "500.00", incomeDay(2026, 1, 30)),
	}
	before := analyzeIncome(t, items)
	if len(before) != 3 {
		t.Fatalf("reference values split a stream: %+v", before)
	}
	items[2].Facts.Description = "acme benefit payment REF: ZZZZZZ"
	after := analyzeIncome(t, items)
	if len(after) != 3 || before[0].Income.PatternID != after[0].Income.PatternID {
		t.Fatal("reference change reidentified a stream")
	}
	if before[0].JudgmentInput.ID == after[0].JudgmentInput.ID {
		t.Fatal("exact request identity ignored changed source evidence")
	}
}

func TestIncomeStreamLeadingReferencesDoNotBecomeMerchantIdentity(t *testing.T) {
	items := []types.AnalysisTransaction{
		incomeTx("a", "TLR004632220712 ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("b", "TLR004509799212 ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("c", "TLR004111111111 ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
	}
	before := analyzeIncome(t, items)
	if len(before) != 3 {
		t.Fatalf("leading references split payroll: %+v", before)
	}
	for _, finding := range before {
		if finding.Provider != "acme" {
			t.Fatalf("reference became merchant label: %s", finding.Provider)
		}
	}
	items[0].Facts.Description = "TLRXXXXXXXX2172 ACME PAYROLL"
	after := analyzeIncome(t, items)
	if len(after) != 3 || before[0].Income.PatternID != after[0].Income.PatternID {
		t.Fatal("leading reference changed pattern identity")
	}
}
