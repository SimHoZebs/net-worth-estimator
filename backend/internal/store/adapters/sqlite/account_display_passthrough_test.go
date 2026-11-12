package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func mustLoad(t *testing.T, s store.Store) *types.FinancialModel {
	t.Helper()
	m, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func findAccount(t *testing.T, m *types.FinancialModel, id string) types.Account {
	t.Helper()
	for _, a := range m.Accounts {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("account %s missing in %+v", id, m.Accounts)
	return types.Account{}
}

func TestPassthroughCreatedOnAccountWrites(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if created.Display == nil || !types.IsPassthroughDisplay(created.Display, "checking") {
		t.Fatalf("create display = %+v", created.Display)
	}
	if created.Display.Name != "Checking" || created.Display.InterestScheduleID != "" || created.Display.PaymentScheduleID != "" {
		t.Fatalf("passthrough shape = %+v", created.Display)
	}
	withBalance, err := s.CreateAccountWithBalance(types.Account{ID: "savings", Name: "Savings", Kind: "cash", Enabled: true}, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !types.IsPassthroughDisplay(withBalance.Display, "savings") {
		t.Fatalf("create with balance display = %+v", withBalance.Display)
	}
	updated, err := s.UpdateAccount(types.Account{ID: "checking", Name: "Renamed", Kind: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !types.IsPassthroughDisplay(updated.Display, "checking") || updated.Display.Name != "Renamed" {
		t.Fatalf("update display = %+v", updated.Display)
	}
	m := mustLoad(t, s)
	for _, id := range []string{"checking", "savings"} {
		a := findAccount(t, m, id)
		if !types.IsPassthroughDisplay(a.Display, id) {
			t.Fatalf("%s display = %+v", id, a.Display)
		}
	}
}

func TestPassthroughProvisionedOnSync(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	resolved, provisioned, _, err := s.ProvisionSyncAccounts([]SyncProvision{{BridgeID: "b1", Name: "Synced", Currency: "USD"}})
	if err != nil {
		t.Fatal(err)
	}
	if provisioned != 1 {
		t.Fatalf("provisioned = %d", provisioned)
	}
	id := resolved["b1"]
	m := mustLoad(t, s)
	a := findAccount(t, m, id)
	if !types.IsPassthroughDisplay(a.Display, id) || a.Display.Name != "Synced" {
		t.Fatalf("provisioned display = %+v", a.Display)
	}
}

func TestDeleteAccountCascadesDisplay(t *testing.T) {
	impl := openSQLiteStore(t)
	s := store.Store(impl)
	if _, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := impl.db.QueryRow(`SELECT COUNT(*) FROM account_displays WHERE account_id = 'checking' AND user_id = :user_id`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("display rows = %d, err %v", count, err)
	}
	if err := s.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	if err := impl.db.QueryRow(`SELECT COUNT(*) FROM account_displays WHERE account_id = 'checking' AND user_id = :user_id`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("display survived delete: %d, %v", count, err)
	}
}

func TestAdoptReplacesPassthroughWithGrouped(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.CreateAccount(types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	legacy, err := s.CreateAccount(types.Account{ID: "legacy", Name: "Legacy", Kind: "debt", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !types.IsPassthroughDisplay(legacy.Display, "legacy") {
		t.Fatalf("legacy display = %+v", legacy.Display)
	}
	b, err := domain.BuildLoan("legacy", "interest", "charge", "pay", types.LoanTerms{Name: "Adopted", Principal: 1000, ObservedAt: 1783987199, AnnualRate: 0.12, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 50, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "cash", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLoan(b, false); err != nil {
		t.Fatal(err)
	}
	m := mustLoad(t, s)
	principal := findAccount(t, m, "legacy")
	if principal.Display == nil || len(principal.Display.Components) != 2 {
		t.Fatalf("adopted display = %+v", principal.Display)
	}
	if types.IsPassthroughDisplay(principal.Display, "legacy") {
		t.Fatal("adoption kept passthrough")
	}
}

func TestSupersedeKeepsSyncedDisplayRenamed(t *testing.T) {
	d := openSharingTestDB(t)
	_, scoped := policyMember(t, d, "alice", "manual", "synced")
	for _, id := range []string{"checking", "manual", "synced"} {
		if _, err := scoped.UpdateAccount(types.Account{ID: id, Name: id, Kind: types.AccountKindCash, Enabled: true}); err != nil {
			t.Fatalf("profile %s: %v", id, err)
		}
	}
	if _, err := scoped.UpdateAccount(types.Account{ID: "manual", Name: "Joint Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
		t.Fatal(err)
	}
	result, err := scoped.SupersedeAccount("manual", "synced", "bridge-1")
	if err != nil || !result.Persisted {
		t.Fatalf("supersede = %+v, %v", result, err)
	}
	m, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Accounts) != 2 {
		t.Fatalf("accounts = %+v", m.Accounts)
	}
	synced := findAccount(t, m, "synced")
	if !types.IsPassthroughDisplay(synced.Display, "synced") {
		t.Fatalf("synced display = %+v", synced.Display)
	}
	if synced.Display.Name != "Joint Checking" {
		t.Fatalf("synced display name = %q, want manual profile", synced.Display.Name)
	}
	for _, a := range m.Accounts {
		if a.ID == "manual" {
			t.Fatal("manual survived")
		}
	}
}
