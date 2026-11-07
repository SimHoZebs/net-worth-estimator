package main

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRefreshCopiesVisibleLoanRelationships(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.User("other")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := domain.BuildLoan("principal", "interest", "charge", "pay", types.LoanTerms{Name: "Education loan", Principal: 1000, ObservedAt: 1783987199, AnnualRate: 0.0399, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 50, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "checking", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(bundle, true); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for _, financialOnly := range []bool{false, true} {
		if err := refresh(target, source, "other", "owner", financialOnly); err != nil {
			t.Fatal(err)
		}
		if got := query(t, target, `SELECT json_extract(display_json, '$.name') FROM account_displays WHERE user_id='owner' AND account_id='principal'`); got != "Education loan" {
			t.Fatalf("copy lost visible account: %s", got)
		}
		if got := query(t, target, `SELECT COUNT(*) FROM accounts WHERE user_id='owner' AND id IN ('principal','interest')`); got != "2" {
			t.Fatalf("copy lost loan components: %s", got)
		}
	}
}
