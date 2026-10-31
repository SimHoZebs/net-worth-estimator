package main

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAuditDB(t *testing.T, path string) store.Store {
	t.Helper()
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatalf("setup database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	scoped, err := database.EnsureUser("u1", "https://issuer.test", "owner")
	if err != nil {
		t.Fatalf("ensure user: %v", err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "prime_card", Name: "Prime"}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	upsert := func(posting types.Posting, key string) {
		t.Helper()
		_, err := scoped.ApplySyncPlan(nil, []store.BankDirective{{
			Upsert: &store.BankUpsert{Posting: posting, Keys: []store.BankKey{
				{Provider: store.SourceSimpleFIN, AccountID: "bridge-prime", TransactionID: key},
			}},
		}})
		if err != nil {
			t.Fatalf("upsert %s: %v", key, err)
		}
	}
	source := "prime_card"
	amount := func(expression string) types.PostingAmountResolution {
		return types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": expression}, Inputs: map[string]types.AmountInputBinding{}}
	}
	upsert(types.Posting{
		Name: "Bistro", Source: store.SourceSimpleFIN, SourceAccountID: &source,
		Amount: amount("50.00"), PostedTime: 1785628800, TransactionTime: 1785628800, Pending: true,
	}, "auth-a")
	rows, err := scoped.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank rows = %+v, err %v", rows, err)
	}
	if _, err := scoped.ApplySyncPlan(nil, []store.BankDirective{{Void: rows[0].Posting.ID}}); err != nil {
		t.Fatalf("void: %v", err)
	}
	upsert(types.Posting{
		Name: "Bistro", Source: store.SourceSimpleFIN, SourceAccountID: &source,
		Amount: amount("58.00"), PostedTime: 1785715200, TransactionTime: 1785715200, Enabled: true,
	}, "post-a")
	return scoped
}

func TestSyncAuditListsPairs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.db")
	scoped := seedAuditDB(t, path)
	if err := run([]string{"--db", path, "--user", "u1", "--account", "prime_card"}); err != nil {
		t.Fatalf("list = %v", err)
	}
	rows, err := scoped.LoadBankPostings()
	if err != nil || len(rows) != 2 {
		t.Fatalf("list mode must not write: rows = %+v, err %v", rows, err)
	}
}

func TestSyncAuditRejectsBadInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.db")
	seedAuditDB(t, path)
	for name, args := range map[string][]string{
		"missing flags": {},
		"unknown user":  {"--db", path, "--user", "ghost", "--account", "prime_card"},
		"unknown card":  {"--db", path, "--user", "u1", "--account", "ghost"},
		"bad format":    {"--db", path, "--user", "u1", "--account", "prime_card", "--format", "yaml"},
		"missing db":    {"--db", filepath.Join(t.TempDir(), "absent.db"), "--user", "u1", "--account", "prime_card"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("%s: want error, got nil", name)
		}
	}
}
