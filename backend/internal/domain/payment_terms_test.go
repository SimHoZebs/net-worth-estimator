package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func termsDocument() *types.FinancialModelDocument {
	return &types.FinancialModelDocument{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: "prime_card", Name: "Prime Card", Kind: types.AccountKindDebt, Enabled: true},
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		},
		Checkpoints: []types.Checkpoint{},
		Postings:    []types.Posting{},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func termsCodes(issues []types.ModelValidationIssue) map[string]bool {
	codes := map[string]bool{}
	for _, issue := range issues {
		codes[issue.Code] = true
	}
	return codes
}

func TestValidatePaymentTermsAcceptsCardRow(t *testing.T) {
	statementDay := 15
	percent := 0.02
	document := termsDocument()
	document.PaymentTerms = []types.PaymentTerms{{
		AccountID: "prime_card", MinimumFixed: 25, MinimumPercent: &percent,
		DueDay: 10, StatementDay: &statementDay,
	}}
	checking := "checking"
	document.Postings = []types.Posting{}
	document.RecurrenceRules = []types.RecurrenceRule{{
		ID: "pay-prime", Name: "Prime payment", SourceAccountID: &checking,
		Destinations: []string{"prime_card"}, Frequency: types.FrequencyMonthly,
		StartDate: "2026-09-10", Enabled: true,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "25"},
		},
	}}
	for _, issue := range ValidateFinancialModel(document, nil) {
		if len(issue.Code) >= 6 && issue.Code[:6] == "terms." && issue.Severity == types.SeverityError {
			t.Fatalf("unexpected terms error: %+v", issue)
		}
	}
}

func TestValidatePaymentTermsRejectsBadRows(t *testing.T) {
	statementDay := 99
	percent := 2.0
	cases := []struct {
		name  string
		terms []types.PaymentTerms
		code  string
	}{
		{"missing account", []types.PaymentTerms{{AccountID: "ghost", MinimumFixed: 25, DueDay: 10}}, "terms.account.missing"},
		{"non-debt account", []types.PaymentTerms{{AccountID: "checking", MinimumFixed: 25, DueDay: 10}}, "terms.account.kind"},
		{"duplicate rows", []types.PaymentTerms{
			{AccountID: "prime_card", MinimumFixed: 25, DueDay: 10},
			{AccountID: "prime_card", MinimumFixed: 30, DueDay: 12},
		}, "terms.account.duplicate"},
		{"negative minimum", []types.PaymentTerms{{AccountID: "prime_card", MinimumFixed: -1, DueDay: 10}}, "terms.minimum.invalid"},
		{"percent over one", []types.PaymentTerms{{AccountID: "prime_card", MinimumFixed: 25, MinimumPercent: &percent, DueDay: 10}}, "terms.minimum.invalid"},
		{"due day zero", []types.PaymentTerms{{AccountID: "prime_card", MinimumFixed: 25, DueDay: 0}}, "terms.dueDay.invalid"},
		{"due day 29", []types.PaymentTerms{{AccountID: "prime_card", MinimumFixed: 25, DueDay: 29}}, "terms.dueDay.invalid"},
		{"statement day 99", []types.PaymentTerms{{AccountID: "prime_card", MinimumFixed: 25, DueDay: 10, StatementDay: &statementDay}}, "terms.statementDay.invalid"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			document := termsDocument()
			document.PaymentTerms = testCase.terms
			if !termsCodes(ValidateFinancialModel(document, nil))[testCase.code] {
				t.Fatalf("expected %q, got %+v", testCase.code, ValidateFinancialModel(document, nil))
			}
		})
	}
}

func TestPaymentTermsByAccountDerivesReverseLookup(t *testing.T) {
	document := termsDocument()
	document.PaymentTerms = []types.PaymentTerms{
		{AccountID: "prime_card", MinimumFixed: 25, DueDay: 10},
	}
	byAccount := PaymentTermsByAccount(document)
	terms, ok := byAccount["prime_card"]
	if !ok || terms.DueDay != 10 {
		t.Fatalf("lookup = %+v, %v", terms, ok)
	}
	if _, ok := byAccount["checking"]; ok {
		t.Fatalf("untermed account must be absent from the lookup")
	}
}

func TestValidatePaymentTermsCoverageWarnsWithoutPaymentShell(t *testing.T) {
	document := termsDocument()
	document.PaymentTerms = []types.PaymentTerms{
		{AccountID: "prime_card", MinimumFixed: 25, DueDay: 10},
	}
	found := false
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "terms.payment.missing" {
			found = true
			if issue.Severity != types.SeverityWarning {
				t.Fatalf("coverage must warn, not block: %+v", issue)
			}
		}
	}
	if !found {
		t.Fatalf("expected a terms.payment.missing warning")
	}
	checking := "checking"
	document.Postings = []types.Posting{}
	document.RecurrenceRules = []types.RecurrenceRule{{
		ID: "pay-prime", Name: "Prime payment", SourceAccountID: &checking,
		Destinations: []string{"prime_card"}, Frequency: types.FrequencyMonthly,
		StartDate: "2026-09-10", Enabled: true,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "25"},
		},
	}}
	for _, issue := range ValidateFinancialModel(document, nil) {
		if issue.Code == "terms.payment.missing" {
			t.Fatalf("payment shell should satisfy coverage: %+v", issue)
		}
	}
}
