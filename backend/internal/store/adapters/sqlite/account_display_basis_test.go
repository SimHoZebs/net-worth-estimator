package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestAccountDisplayBasisRoundTrip(t *testing.T) {
	s := openTestStore(t)
	// Absent basis defaults to available on write and read.
	created, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if created.DisplayBasis != types.DisplayBasisAvailable {
		t.Fatalf("create basis = %q", created.DisplayBasis)
	}
	posted := types.DisplayBasisPosted
	updated, err := s.UpdateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true, DisplayBasis: posted})
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayBasis != types.DisplayBasisPosted {
		t.Fatalf("update basis = %q", updated.DisplayBasis)
	}
	m := mustLoad(t, s)
	if got := findAccount(t, m, "checking").DisplayBasis; got != types.DisplayBasisPosted {
		t.Fatalf("loaded basis = %q", got)
	}
	// Import round-trips an explicit basis and defaults an absent one.
	if _, err := s.ImportModel(&types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true, DisplayBasis: types.DisplayBasisPosted},
			{ID: "savings", Name: "Savings", Kind: "cash", Enabled: true},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}); err != nil {
		t.Fatal(err)
	}
	m = mustLoad(t, s)
	if got := findAccount(t, m, "checking").DisplayBasis; got != types.DisplayBasisPosted {
		t.Fatalf("imported checking basis = %q", got)
	}
	if got := findAccount(t, m, "savings").DisplayBasis; got != types.DisplayBasisAvailable {
		t.Fatalf("imported savings basis = %q", got)
	}
}
