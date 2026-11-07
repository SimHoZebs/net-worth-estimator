package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
	"reflect"
	"testing"
)

func TestLoanAtomicFailureAndImportRoundTrip(t *testing.T) {
	s := openTestStore(t)
	_, err := s.CreateAccount(types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	b, err := domain.BuildLoan("principal", "interest", "charge", "payment", types.LoanTerms{Name: "Loan", Principal: 1000, AccruedInterest: 10, ObservedAt: 1783987199, AnnualRate: 0.12, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 50, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	// Fail after account and observation inserts: rule identity collision.
	if _, err := s.CreateSchedule(types.Schedule{ID: "payment", Name: "Collision", Frequency: "monthly", StartDate: "2026-08-13", Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(b, true); err == nil {
		t.Fatal("expected collision")
	}
	m, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Accounts) != 1 || len(m.Checkpoints) != 0 || len(m.Schedules) != 1 {
		t.Fatal("partial loan persisted")
	}
	if err := s.DeleteSchedule("payment"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(b, true); err != nil {
		t.Fatal(err)
	}
	m, _ = s.LoadModel()
	if _, err := s.ImportModel(m); err != nil {
		t.Fatal(err)
	}
	m, _ = s.LoadModel()
	if m.Accounts[1].Display == nil || m.Accounts[1].Display.Components[1].AccountID != "interest" {
		t.Fatal("import lost relationship")
	}
}

func TestLoanWritesStayWithinUserScope(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "loan-a"), privateTestPlan(t, d, "loan-b")
	bundle, err := domain.BuildLoan("principal", "interest", "charge", "payment", types.LoanTerms{Name: "Loan", Principal: 1000, ObservedAt: 1783987199, AnnualRate: 0.12, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 50, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []*sqliteStore{a, b} {
		if _, err := s.CreateAccount(types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SaveLoan(bundle, true); err != nil {
			t.Fatal(err)
		}
	}
	before, err := b.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteLoan("principal"); err != nil {
		t.Fatal(err)
	}
	after, err := b.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("loan deletion crossed user scope")
	}
}
